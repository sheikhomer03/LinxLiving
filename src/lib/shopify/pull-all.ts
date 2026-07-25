import { pullProductsFromShopify } from "./pull-products";
import { pullCollectionsFromShopify } from "./sync-collection";
import { pullDiscountsFromShopify } from "./sync-coupon";
import {
  pullAbandonedCheckouts,
  pullCustomersFromShopify,
  pullOrdersFromShopify,
} from "./sync-commerce";
import connectDB from "@/lib/mongodb";
import { Subscriber } from "@/models/Subscriber";
import { shopifyAdminRequest } from "./admin";

/**
 * Pull major Shopify domains into Mongo so admin + UI stay in sync.
 */
export async function pullAllFromShopify(limit = 50) {
  const results: Record<string, { ok: boolean; pulled?: number; error?: string; extra?: unknown }> =
    {};

  try {
    results.products = {
      ok: true,
      ...(await pullProductsFromShopify({ first: limit })),
    };
  } catch (error) {
    results.products = {
      ok: false,
      error: error instanceof Error ? error.message : "Products pull failed",
    };
  }

  try {
    results.collections = {
      ok: true,
      ...(await pullCollectionsFromShopify(limit)),
    };
  } catch (error) {
    results.collections = {
      ok: false,
      error: error instanceof Error ? error.message : "Collections pull failed",
    };
  }

  try {
    results.discounts = {
      ok: true,
      ...(await pullDiscountsFromShopify(limit)),
    };
  } catch (error) {
    results.discounts = {
      ok: false,
      error: error instanceof Error ? error.message : "Discounts pull failed",
    };
  }

  try {
    results.customers = {
      ok: true,
      ...(await pullCustomersFromShopify(limit)),
    };
  } catch (error) {
    results.customers = {
      ok: false,
      error: error instanceof Error ? error.message : "Customers pull failed",
    };
  }

  try {
    results.orders = {
      ok: true,
      ...(await pullOrdersFromShopify(limit)),
    };
  } catch (error) {
    results.orders = {
      ok: false,
      error: error instanceof Error ? error.message : "Orders pull failed",
    };
  }

  try {
    // Subscribers: customers with email marketing consent
    const data = await shopifyAdminRequest<{
      customers: {
        nodes: {
          id: string;
          email: string;
          emailMarketingConsent?: { marketingState?: string };
        }[];
      };
    }>(
      `
      query MarketingCustomers($first: Int!) {
        customers(first: $first, query: "email_marketing_state:subscribed") {
          nodes {
            id
            email
            emailMarketingConsent { marketingState }
          }
        }
      }
    `,
      { first: limit },
    );

    await connectDB();
    let pulled = 0;
    for (const c of data.customers.nodes) {
      if (!c.email) continue;
      await Subscriber.findOneAndUpdate(
        { email: c.email.toLowerCase() },
        {
          email: c.email.toLowerCase(),
          shopifyCustomerId: c.id,
          source: "shopify",
        },
        { upsert: true, new: true },
      );
      pulled += 1;
    }
    results.subscribers = { ok: true, pulled };
  } catch (error) {
    results.subscribers = {
      ok: false,
      error: error instanceof Error ? error.message : "Subscribers pull failed",
    };
  }

  try {
    const abandoned = await pullAbandonedCheckouts(Math.min(limit, 25));
    results.checkouts = {
      ok: true,
      pulled: abandoned.count,
      extra: abandoned.checkouts,
    };
  } catch (error) {
    results.checkouts = {
      ok: false,
      error: error instanceof Error ? error.message : "Checkouts pull failed",
    };
  }

  // Brands: collections with handle starting with brand-
  try {
    await connectDB();
    const { Brand } = await import("@/models/Brand");
    const data = await shopifyAdminRequest<{
      collections: { nodes: { id: string; title: string; handle: string; image?: { url?: string } }[] };
    }>(
      `
      query BrandCollections($first: Int!) {
        collections(first: $first, query: "title:*") {
          nodes { id title handle image { url } }
        }
      }
    `,
      { first: limit },
    );

    let pulled = 0;
    for (const node of data.collections.nodes) {
      if (!node.handle?.startsWith("brand-")) continue;
      const slug = node.handle.replace(/^brand-/, "");
      await Brand.findOneAndUpdate(
        { $or: [{ shopifyCollectionId: node.id }, { slug }] },
        {
          name: node.title,
          slug,
          image: node.image?.url || "",
          isActive: true,
          shopifyCollectionId: node.id,
          shopifySyncedAt: new Date(),
          shopifySyncError: null,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      pulled += 1;
    }
    results.brands = { ok: true, pulled };
  } catch (error) {
    results.brands = {
      ok: false,
      error: error instanceof Error ? error.message : "Brands pull failed",
    };
  }

  return results;
}

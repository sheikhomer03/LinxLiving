import { pullProductsFromShopify } from "./pull-products";
import { pushUnsyncedProducts } from "./sync-product";
import {
  pullBrandsFromShopify,
  pullCollectionsFromShopify,
  pullMenusFromShopify,
  pushUnsyncedBrandsAndCollections,
} from "./sync-collection";
import {
  pullDiscountsFromShopify,
  pushUnsyncedCoupons,
} from "./sync-coupon";
import {
  pullAbandonedCheckouts,
  pullCustomersFromShopify,
  pullOrdersFromShopify,
  pushUnsyncedCustomers,
} from "./sync-commerce";
import {
  pullInquiriesFromShopify,
  pushUnsyncedInquiries,
} from "./sync-message";
import connectDB from "@/lib/mongodb";
import { Subscriber } from "@/models/Subscriber";
import { shopifyAdminRequest } from "./admin";

/**
 * Two-way sync:
 * 1) Push local stale/missing catalog → Shopify (so Living edits win)
 * 2) Pull Shopify → Mongo
 * 3) Push remaining customers/inquiries (and any leftover missing links)
 */
export async function pullAllFromShopify(limit = 50) {
  const results: Record<
    string,
    { ok: boolean; pulled?: number; error?: string; extra?: unknown }
  > = {};
  const batch = Math.min(Math.max(limit, 1), 50);

  // ── 1. Outbound first (Living wins for stale rows) ─────────────────
  try {
    const productsOut = await pushUnsyncedProducts(batch);
    results.pushProducts = {
      ok: true,
      pulled: productsOut.pushed,
      extra: productsOut,
    };
  } catch (error) {
    results.pushProducts = {
      ok: false,
      error:
        error instanceof Error ? error.message : "Product push catch-up failed",
    };
  }

  try {
    const pushed = await pushUnsyncedBrandsAndCollections(batch);
    const coupons = await pushUnsyncedCoupons(batch);
    results.pushCatalog = {
      ok: true,
      pulled:
        pushed.brands +
        pushed.collections +
        (pushed.menus || 0) +
        coupons.pushed,
      extra: { ...pushed, coupons: coupons.pushed },
    };
  } catch (error) {
    results.pushCatalog = {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Brand/collection/coupon push failed",
    };
  }

  // ── 2. Inbound from Shopify ────────────────────────────────────────
  try {
    results.products = {
      ok: true,
      ...(await pullProductsFromShopify({ first: batch })),
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
      ...(await pullCollectionsFromShopify(batch)),
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
      ...(await pullDiscountsFromShopify(batch)),
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
      ...(await pullCustomersFromShopify(batch)),
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
      ...(await pullOrdersFromShopify(batch)),
    };
  } catch (error) {
    results.orders = {
      ok: false,
      error: error instanceof Error ? error.message : "Orders pull failed",
    };
  }

  try {
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
      { first: batch },
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
        { upsert: true, returnDocument: "after" },
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
    const abandoned = await pullAbandonedCheckouts(Math.min(batch, 25));
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

  try {
    results.brands = {
      ok: true,
      ...(await pullBrandsFromShopify(batch)),
    };
  } catch (error) {
    results.brands = {
      ok: false,
      error: error instanceof Error ? error.message : "Brands pull failed",
    };
  }

  try {
    results.menus = {
      ok: true,
      ...(await pullMenusFromShopify(batch)),
    };
  } catch (error) {
    results.menus = {
      ok: false,
      error: error instanceof Error ? error.message : "Menus pull failed",
    };
  }

  try {
    results.messages = {
      ok: true,
      ...(await pullInquiriesFromShopify(batch)),
    };
  } catch (error) {
    results.messages = {
      ok: false,
      error: error instanceof Error ? error.message : "Messages pull failed",
    };
  }

  // ── 3. Remaining outbound (customers / inquiries + any leftover links)
  try {
    const pushed = await pushUnsyncedBrandsAndCollections(
      Math.min(batch, 15),
    );
    const coupons = await pushUnsyncedCoupons(Math.min(batch, 15));
    const customers = await pushUnsyncedCustomers(batch);
    const inquiries = await pushUnsyncedInquiries(batch);
    results.pushUnsynced = {
      ok: true,
      pulled:
        pushed.brands +
        pushed.collections +
        (pushed.menus || 0) +
        coupons.pushed +
        customers.pushed +
        inquiries.pushed,
      extra: {
        ...pushed,
        coupons: coupons.pushed,
        customers: customers.pushed,
        messages: inquiries.pushed,
      },
    };
  } catch (error) {
    results.pushUnsynced = {
      ok: false,
      error:
        error instanceof Error ? error.message : "Outbound catch-up failed",
    };
  }

  return results;
}

import { pullProductsFromShopify } from "./pull-products";
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
 * Pull major Shopify domains into Mongo so admin + UI stay in sync.
 * Also pushes any local Brands / Collections / Coupons missing Shopify IDs.
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

  try {
    results.brands = {
      ok: true,
      ...(await pullBrandsFromShopify(limit)),
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
      ...(await pullMenusFromShopify(limit)),
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
      ...(await pullInquiriesFromShopify(limit)),
    };
  } catch (error) {
    results.messages = {
      ok: false,
      error: error instanceof Error ? error.message : "Messages pull failed",
    };
  }

  // Outbound catch-up: local records that never got Shopify IDs
  try {
    const pushed = await pushUnsyncedBrandsAndCollections(
      Math.min(limit, 15),
    );
    const coupons = await pushUnsyncedCoupons(Math.min(limit, 15));
    const customers = await pushUnsyncedCustomers(Math.min(limit, 15));
    const inquiries = await pushUnsyncedInquiries(Math.min(limit, 15));
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

"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listShopifyPaidOrders } from "@/lib/shopify/sync-order";
import { pullOrdersFromShopify } from "@/lib/shopify/sync-commerce";
import { isShopifyConfigured } from "@/lib/shopify";

export async function getShopifyTransactions(limit = 50) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as { role?: string }).role !== "admin") {
      return { success: false, error: "Unauthorized", data: [] as any[] };
    }

    if (isShopifyConfigured()) {
      try {
        await pullOrdersFromShopify(Math.min(limit, 50));
      } catch {
        // Still return Mongo-cached Shopify orders if pull fails
      }
    }

    const data = await listShopifyPaidOrders(limit);
    return {
      success: true,
      data,
      hasMore: false,
      source: "shopify",
    };
  } catch (error) {
    console.error("Shopify transactions error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load Shopify payments",
      data: [] as any[],
    };
  }
}

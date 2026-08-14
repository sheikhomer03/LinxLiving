"use server";

import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  isShopifyConfigured,
  isShopifySyncEnabled,
  updateShopifyProduct,
} from "@/lib/shopify";
import { pullProductsFromShopify } from "@/lib/shopify/pull-products";
import {
  listShopifyWebhooks,
  registerProductWebhooks,
} from "@/lib/shopify/webhooks";
import { pullAllFromShopify } from "@/lib/shopify/pull-all";
import { Brand } from "@/models/Brand";
import mongoose from "mongoose";

/**
 * Push a product's variants to Shopify and store each returned GID on its row.
 *
 * Single-variant products are left to the ordinary product sync — their one
 * price already lives on the product-level variant. Failure is reported rather
 * than thrown: the product itself synced fine, and losing that because one
 * option axis was malformed would be worse than an unsellable variant.
 */
async function syncProductVariants(
  product: {
    variants?: {
      _id?: unknown;
      name?: string;
      sku?: string;
      barcode?: string;
      price?: number | null;
      compareAtPrice?: number | null;
      stock?: number;
      options?: Record<string, unknown> | null;
      option1?: string;
      option2?: string;
      option3?: string;
      shopifyVariantId?: string;
      shopifyInventoryItemId?: string;
    }[];
    price: number;
    stock: number;
    shopifyOptions?: unknown;
  },
  shopifyProductId: string,
) {
  const rows = product.variants ?? [];
  if (rows.length < 2) return { skipped: true as const, reason: "single variant" };

  const { syncVariantsToShopify } = await import("@/lib/shopify/sync-variants");

  // Axis names come from `options` when the supplier gave them, falling back to
  // the positional option1..3 with the product's own axis names.
  const axisNames = Array.isArray(product.shopifyOptions)
    ? (product.shopifyOptions as { name?: string }[])
        .map((a) => String(a?.name || "").trim())
        .filter(Boolean)
    : [];

  const payload = rows.map((row, index) => {
    const options: { name: string; value: string }[] = [];
    if (row.options && typeof row.options === "object") {
      for (const [name, value] of Object.entries(row.options)) {
        if (name && value != null && String(value).trim()) {
          options.push({ name, value: String(value) });
        }
      }
    }
    if (!options.length) {
      [row.option1, row.option2, row.option3].forEach((value, i) => {
        if (value && String(value).trim()) {
          options.push({
            name: axisNames[i] || `Option ${i + 1}`,
            value: String(value),
          });
        }
      });
    }
    return {
      key: String(row._id ?? index),
      name: row.name || `Variant ${index + 1}`,
      sku: row.sku || null,
      barcode: row.barcode || null,
      price: Number(row.price ?? product.price) || 0,
      compareAtPrice: row.compareAtPrice ?? null,
      stock: Number(row.stock ?? product.stock) || 0,
      options,
    };
  });

  try {
    const result = await syncVariantsToShopify(shopifyProductId, payload);
    for (const [index, row] of rows.entries()) {
      const key = String(row._id ?? index);
      if (result.linked[key]) row.shopifyVariantId = result.linked[key];
      if (result.inventoryItems[key]) {
        row.shopifyInventoryItemId = result.inventoryItems[key];
      }
    }
    return {
      skipped: false as const,
      created: result.created,
      updated: result.updated,
      linked: Object.keys(result.linked).length,
      total: rows.length,
      orphaned: result.orphaned.length,
      warnings: result.warnings,
    };
  } catch (error) {
    return {
      skipped: false as const,
      error: error instanceof Error ? error.message : "Variant sync failed",
    };
  }
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    throw new Error("Unauthorized");
  }
}

/**
 * Push one Mongo product (or all unsynced) to Shopify.
 * Useful for migrating existing catalog after connecting Shopify.
 */
export async function syncMongoProductToShopify(productId: string) {
  await requireAdmin();
  if (!isShopifySyncEnabled()) {
    return { success: false, error: "Shopify sync is disabled" };
  }

  await connectDB();
  const product = await Product.findById(productId);
  if (!product) return { success: false, error: "Product not found" };

  let brandName: string | null = null;
  if (product.brand && mongoose.Types.ObjectId.isValid(String(product.brand))) {
    const brand = await Brand.findById(product.brand).select("name").lean();
    brandName = brand?.name ?? null;
  }

  try {
    const { ensureShopifyProductLinked } = await import(
      "@/lib/shopify/sync-product"
    );
    const payload = {
      name: product.name,
      description: product.description,
      price: product.price,
      stock: product.stock,
      category: product.category,
      subCategory: product.subCategory,
      brandName,
      images: product.images ?? [],
      tagline: product.tagline,
      specs: product.specs ?? {},
      shopifyProductId: product.shopifyProductId,
      shopifyVariantId: product.shopifyVariantId,
    };

    // Verifies IDs on the current shop; recreates when stale (e.g. after store switch)
    const ids = await ensureShopifyProductLinked(payload);
    // Keep price/stock/title in sync when the link already existed
    if (
      ids.productId === product.shopifyProductId &&
      ids.variantId === product.shopifyVariantId
    ) {
      await updateShopifyProduct({ ...payload, ...ids });
    }

    product.shopifyProductId = ids.productId;
    product.shopifyVariantId = ids.variantId;

    // A product with options is not sellable through Shopify checkout until
    // each of its variants exists there — the cart charges the variant's own
    // price, so one shared GID would bill every size the same.
    const variantSync = await syncProductVariants(product, ids.productId);

    product.shopifySyncError = null;
    product.shopifySyncedAt = new Date();
    await product.save();

    return { success: true, ...ids, variants: variantSync };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Shopify sync failed";
    product.shopifySyncError = message;
    product.shopifySyncedAt = new Date();
    await product.save();
    return { success: false, error: message };
  }
}

export async function syncAllUnsyncedProductsToShopify(limit = 25) {
  await requireAdmin();
  if (!isShopifySyncEnabled()) {
    return { success: false, error: "Shopify sync is disabled" };
  }

  await connectDB();
  // Include already-linked products so stale GIDs from a previous store get relinked
  const products = await Product.find({})
    .sort({
      shopifySyncError: -1,
      shopifyProductId: 1,
      createdAt: -1,
    })
    .limit(Math.min(limit, 100));

  const results: { id: string; name: string; ok: boolean; error?: string }[] =
    [];

  for (const product of products) {
    const result = await syncMongoProductToShopify(String(product._id));
    results.push({
      id: String(product._id),
      name: product.name,
      ok: Boolean(result.success),
      error: result.error,
    });
  }

  return {
    success: true,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/**
 * Shopify → Mongo: import/refresh products so admin + storefront show them.
 */
export async function pullShopifyProductsIntoMongo(limit = 50) {
  await requireAdmin();
  if (!isShopifyConfigured()) {
    return { success: false as const, error: "Shopify is not configured" };
  }

  try {
    const result = await pullProductsFromShopify({ first: limit });
    return { success: true as const, ...result };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Pull failed",
    };
  }
}

/**
 * Pull only discount codes (for testing coupon sync).
 */
export async function pullShopifyCouponsIntoMongo(limit = 50) {
  await requireAdmin();
  if (!isShopifyConfigured()) {
    return { success: false as const, error: "Shopify is not configured" };
  }

  try {
    const { pullDiscountsFromShopify } = await import(
      "@/lib/shopify/sync-coupon"
    );
    const result = await pullDiscountsFromShopify(limit);
    return { success: true as const, ...result };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Coupon pull failed",
    };
  }
}

/**
 * Pull products, collections, brands, discounts, customers, orders, subscribers, checkouts.
 */
export async function pullEverythingFromShopify(limit = 50) {
  await requireAdmin();
  if (!isShopifyConfigured()) {
    return { success: false as const, error: "Shopify is not configured" };
  }

  try {
    const results = await pullAllFromShopify(limit);
    return { success: true as const, results };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Pull all failed",
    };
  }
}

/**
 * Register products/create|update|delete webhooks for live two-way sync.
 * Requires a public HTTPS base URL (production or ngrok).
 */
export async function enableShopifyProductWebhooks(callbackBaseUrl?: string) {
  await requireAdmin();
  if (!isShopifyConfigured()) {
    return { success: false as const, error: "Shopify is not configured" };
  }

  const base =
    callbackBaseUrl?.trim() ||
    process.env.SHOPIFY_WEBHOOK_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim();

  if (!base || base.includes("localhost") || base.includes("127.0.0.1")) {
    return {
      success: false as const,
      error:
        "Webhooks need a public HTTPS URL. Set SHOPIFY_WEBHOOK_BASE_URL to your ngrok/production URL (not localhost).",
    };
  }

  try {
    const result = await registerProductWebhooks(base);
    return { success: true as const, ...result };
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Webhook registration failed",
    };
  }
}

export async function getShopifyWebhookStatus() {
  await requireAdmin();
  if (!isShopifyConfigured()) {
    return {
      success: false as const,
      error: "Shopify is not configured",
      webhooks: [] as { id: string; topic: string; endpoint: { callbackUrl?: string } }[],
    };
  }
  try {
    const webhooks = await listShopifyWebhooks();
    return { success: true as const, webhooks };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to list webhooks",
      webhooks: [] as { id: string; topic: string; endpoint: { callbackUrl?: string } }[],
    };
  }
}

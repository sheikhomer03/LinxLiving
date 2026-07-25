"use server";

import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createShopifyProduct,
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

    const ids = product.shopifyProductId
      ? await updateShopifyProduct(payload)
      : await createShopifyProduct(payload);

    product.shopifyProductId = ids.productId;
    product.shopifyVariantId = ids.variantId;
    product.shopifySyncError = null;
    product.shopifySyncedAt = new Date();
    await product.save();

    return { success: true, ...ids };
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
  const products = await Product.find({
    $or: [
      { shopifyProductId: null },
      { shopifyProductId: { $exists: false } },
      { shopifySyncError: { $ne: null } },
    ],
  })
    .sort({ createdAt: -1 })
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

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { Brand } from "@/models/Brand";
import {
  createShopifyCheckoutCart,
  isShopifyCheckoutEnabled,
} from "@/lib/shopify/cart";
import { isShopifyConfigured, isShopifySyncEnabled } from "@/lib/shopify";
import { ensureShopifyProductLinked } from "@/lib/shopify/sync-product";
import mongoose from "mongoose";

type CartLineBody = {
  id: string;
  quantity: number;
  shopifyVariantId?: string | null;
};

/**
 * Build a Shopify cart and return hosted checkout URL.
 * POST /api/checkout/shopify
 */
export async function POST(req: Request) {
  try {
    if (!isShopifyConfigured()) {
      return NextResponse.json(
        { error: "Shopify is not configured" },
        { status: 400 },
      );
    }

    if (!isShopifyCheckoutEnabled()) {
      return NextResponse.json(
        {
          error:
            "Shopify Checkout is disabled. Set SHOPIFY_CHECKOUT_ENABLED=true and SHOPIFY_STOREFRONT_ACCESS_TOKEN.",
        },
        { status: 400 },
      );
    }

    const body = await req.json();
    const items = (body.items || []) as CartLineBody[];
    const email = typeof body.email === "string" ? body.email : undefined;
    const promoCode =
      typeof body.promoCode === "string" && body.promoCode.trim()
        ? body.promoCode.trim()
        : undefined;

    if (!items.length) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    if (
      items.some(
        (item) =>
          String(item.id || "").startsWith("cfg:") ||
          (item as { isConfigured?: boolean }).isConfigured,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Made-to-measure configured items must use site checkout (not Shopify Checkout).",
        },
        { status: 400 },
      );
    }

    await connectDB();

    const lines: { merchandiseId: string; quantity: number }[] = [];

    for (const item of items) {
      if (!item.id) {
        return NextResponse.json(
          { error: "Cart item missing product id" },
          { status: 400 },
        );
      }

      // Always resolve from Mongo — ignore stale variant GIDs cached in the browser cart
      const product = await Product.findById(item.id).lean();
      if (!product) {
        return NextResponse.json(
          { error: `Product ${item.id} was not found` },
          { status: 400 },
        );
      }

      let brandName: string | null = null;
      const brandRef = (product as any).brand;
      if (brandRef && mongoose.Types.ObjectId.isValid(String(brandRef))) {
        const brand = await Brand.findById(brandRef).select("name").lean();
        brandName = brand?.name ?? null;
      }

      let variantId = String((product as any).shopifyVariantId || "");

      // Relink when IDs are from an old store or product was never published
      if (isShopifySyncEnabled()) {
        try {
          const ids = await ensureShopifyProductLinked({
            name: (product as any).name,
            description: (product as any).description,
            price: (product as any).price,
            stock: (product as any).stock,
            category: (product as any).category,
            subCategory: (product as any).subCategory,
            brandName,
            images: (product as any).images ?? [],
            tagline: (product as any).tagline,
            specs: (product as any).specs ?? {},
            showSpecs: (product as any).showSpecs,
            schematicImage: (product as any).schematicImage,
            shopifyProductId: (product as any).shopifyProductId,
            shopifyVariantId: (product as any).shopifyVariantId,
          });

          variantId = ids.variantId;

          if (
            ids.productId !== (product as any).shopifyProductId ||
            ids.variantId !== (product as any).shopifyVariantId
          ) {
            await Product.findByIdAndUpdate(item.id, {
              shopifyProductId: ids.productId,
              shopifyVariantId: ids.variantId,
              shopifySyncError: null,
              shopifySyncedAt: new Date(),
            });
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Shopify relink failed";
          return NextResponse.json(
            {
              error: `"${(product as any).name}" could not be linked to Shopify: ${message}`,
            },
            { status: 400 },
          );
        }
      }

      if (!variantId) {
        return NextResponse.json(
          {
            error: `"${(product as any).name}" is not synced to Shopify yet. Open Admin → Settings → Shopify and sync products.`,
          },
          { status: 400 },
        );
      }

      lines.push({
        merchandiseId: variantId,
        quantity: Math.max(1, Number(item.quantity) || 1),
      });
    }

    const cart = await createShopifyCheckoutCart(lines, {
      email,
      discountCodes: promoCode ? [promoCode] : undefined,
      note: "Linx Square headless checkout",
    });

    return NextResponse.json({
      success: true,
      checkoutUrl: cart.checkoutUrl,
      cartId: cart.cartId,
    });
  } catch (error) {
    console.error("Shopify checkout error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start Shopify Checkout",
      },
      { status: 500 },
    );
  }
}

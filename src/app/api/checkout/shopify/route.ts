import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import {
  createShopifyCheckoutCart,
  isShopifyCheckoutEnabled,
} from "@/lib/shopify/cart";
import { isShopifyConfigured } from "@/lib/shopify";

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

    await connectDB();

    const lines: { merchandiseId: string; quantity: number }[] = [];

    for (const item of items) {
      let variantId = item.shopifyVariantId || null;
      if (!variantId && item.id) {
        const product = await Product.findById(item.id)
          .select("shopifyVariantId name")
          .lean();
        variantId = (product as any)?.shopifyVariantId || null;
        if (!variantId) {
          return NextResponse.json(
            {
              error: `"${(product as any)?.name || item.id}" is not synced to Shopify yet. Open Admin → Settings → Shopify and sync products.`,
            },
            { status: 400 },
          );
        }
      }

      lines.push({
        merchandiseId: variantId!,
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

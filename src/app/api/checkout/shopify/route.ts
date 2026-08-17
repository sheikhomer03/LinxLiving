import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { Brand } from "@/models/Brand";
import {
  createShopifyCheckoutCart,
  isShopifyCheckoutEnabled,
} from "@/lib/shopify/cart";
import {
  createShopifyDraftOrderCheckout,
  type ShopifyDraftLine,
} from "@/lib/shopify/draft-order";
import { verifyConfiguredUnitPrice } from "@/lib/configuredPrice";
import { isShopifyConfigured, isShopifySyncEnabled } from "@/lib/shopify";
import { ensureShopifyProductLinked } from "@/lib/shopify/sync-product";
import mongoose from "mongoose";

type CartLineBody = {
  id: string;
  quantity: number;
  shopifyVariantId?: string | null;
  /** Mongo product id — `id` is a cart-line key and may name a variant. */
  productId?: string | null;
  /** Label of the chosen option, for error messages. */
  configurationSummary?: string | null;
  /**
   * Made-to-measure line: no SKU, no stock, and a price derived from the
   * customer's own dimensions rather than from any variant.
   */
  isConfigured?: boolean;
  /** Line name and unit price — only read for a configured line. */
  name?: string | null;
  price?: number | null;
  configWidthMm?: number | null;
  configHeightMm?: number | null;
  /** Selectors the server re-prices against — see lib/configuredPrice.ts. */
  configKind?: "area" | "pooky" | "ufhs" | "size" | "colour" | null;
  configAreaM2?: number | null;
  configPacks?: number | null;
  configVariantSku?: string | null;
  configPooky?: {
    baseIndex: number | null;
    shadeIndex: number | null;
    pendantIndex: number | null;
    wallFittingIndex: number | null;
    shadeTab: "shade" | "pendant";
  } | null;
};

/**
 * A configured line is one Shopify's Cart API cannot express: its price is not
 * any variant's price. `cfg:` keys are the older marker for the same thing.
 */
function isConfiguredLine(item: CartLineBody) {
  return Boolean(item.isConfigured) || String(item.id || "").startsWith("cfg:");
}

/**
 * Which Mongo variant a cart line refers to, and whether it is sellable.
 *
 * A line names a variant when its key carries a suffix ("<id>::CHROME-900")
 * or when the browser sent a variant GID. The suffix is the variant's SKU, or
 * its display label when it had none, so both are matched.
 */
function resolveChosenVariant(
  product: unknown,
  item: CartLineBody,
): { required: boolean; shopifyVariantId?: string; label?: string } {
  const variants = ((product as { variants?: unknown[] }).variants ??
    []) as {
    name?: string;
    sku?: string;
    shopifyVariantId?: string;
  }[];
  const suffix = String(item.id).includes("::")
    ? String(item.id).split("::").slice(1).join("::")
    : "";

  // Cambridge Skylights roof pitch / add-on picks ("<id>::pitch::...") are not
  // Shopify variants — they're descriptive selections kept only in Mongo, so
  // this suffix names no SKU to look up. Sell the base product as normal.
  if (suffix.startsWith("pitch::")) {
    return { required: false };
  }

  if (!suffix) {
    // No option chosen. A multi-variant product still has to name one —
    // Shopify has no "the product" to charge once options exist.
    if (variants.length > 1) {
      return { required: true, shopifyVariantId: undefined };
    }
    return { required: false };
  }

  const match = variants.find(
    (v) =>
      (v.sku && String(v.sku).trim() === suffix) ||
      (v.name && String(v.name).trim() === suffix),
  );
  return {
    required: true,
    shopifyVariantId: match?.shopifyVariantId
      ? String(match.shopifyVariantId)
      : undefined,
    label: item.configurationSummary || match?.name || suffix,
  };
}

/**
 * Is Shopify hosted checkout actually available right now?
 * GET /api/checkout/shopify
 *
 * The client cannot answer this for itself: NEXT_PUBLIC_SHOPIFY_CHECKOUT_ENABLED
 * is inlined at build time, so a bundle built without it believes Shopify is
 * off and silently routes customers into the site's own checkout. This reads
 * the live server config instead, so the answer follows the running
 * environment rather than whatever was set when the bundle was compiled.
 */
export async function GET() {
  return NextResponse.json({
    enabled: isShopifyConfigured() && isShopifyCheckoutEnabled(),
  });
}

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
    // Made-to-measure lines, carried separately: they have no variant to name,
    // so the basket has to go out as a draft order rather than a cart.
    const customLines: ShopifyDraftLine[] = [];

    for (const item of items) {
      // A configured line is sold at the price the configurator worked out, so
      // there is no variant to resolve and no stock to check. Shopify is still
      // the one taking the money — as a custom line on a draft order.
      if (isConfiguredLine(item)) {
        // The browser worked this price out, and Shopify is about to charge it,
        // so it is checked against the product in Mongo before it is trusted.
        const configuredProductId = String(
          item.productId || String(item.id).split("::")[0] || "",
        );
        if (!mongoose.Types.ObjectId.isValid(configuredProductId)) {
          return NextResponse.json(
            { error: `Cart line "${item.id}" does not name a product` },
            { status: 400 },
          );
        }
        const configuredProduct = await Product.findById(configuredProductId)
          .lean()
          .catch(() => null);
        if (!configuredProduct) {
          return NextResponse.json(
            { error: `Product ${configuredProductId} was not found` },
            { status: 400 },
          );
        }

        const verdict = verifyConfiguredUnitPrice(
          configuredProduct as Record<string, unknown>,
          {
            kind: item.configKind ?? null,
            quantity: Math.max(1, Number(item.quantity) || 1),
            claimedUnitPrice: Number(item.price),
            areaM2: item.configAreaM2 ?? null,
            packs: item.configPacks ?? null,
            widthMm: item.configWidthMm ?? null,
            heightMm: item.configHeightMm ?? null,
            variantSku: item.configVariantSku ?? null,
            pooky: item.configPooky ?? null,
          },
        );
        if (!verdict.ok) {
          console.warn(
            `[checkout] configured line refused: product=${configuredProductId} claimed=${item.price} floor=${verdict.floor} basis=${verdict.basis}`,
          );
          return NextResponse.json({ error: verdict.error }, { status: 400 });
        }

        const unitPrice = verdict.unitPrice;
        const attributes: { key: string; value: string }[] = [];
        if (item.configurationSummary)
          attributes.push({ key: "Specification", value: item.configurationSummary });
        if (item.configWidthMm)
          attributes.push({ key: "Width (mm)", value: String(item.configWidthMm) });
        if (item.configHeightMm)
          attributes.push({ key: "Height (mm)", value: String(item.configHeightMm) });
        if (item.configAreaM2)
          attributes.push({ key: "Area (m²)", value: String(item.configAreaM2) });
        if (item.configPacks)
          attributes.push({ key: "Packs", value: String(item.configPacks) });
        attributes.push({ key: "Product reference", value: configuredProductId });

        customLines.push({
          kind: "custom",
          title: String(item.name || "Made-to-measure item"),
          unitPrice,
          quantity: Math.max(1, Number(item.quantity) || 1),
          attributes,
        });
        continue;
      }

      if (!item.id) {
        return NextResponse.json(
          { error: "Cart item missing product id" },
          { status: 400 },
        );
      }

      // `id` is a cart-line key: for a chosen option it reads
      // "<productId>::CHROME-900". The product is `productId` when the client
      // sent it, else the part before the separator, else the id itself.
      const productId = String(
        item.productId || String(item.id).split("::")[0] || item.id,
      );
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return NextResponse.json(
          { error: `Cart line "${item.id}" does not name a product` },
          { status: 400 },
        );
      }

      // Always resolve from Mongo — ignore stale variant GIDs cached in the browser cart
      const product = await Product.findById(productId).lean();
      if (!product) {
        return NextResponse.json(
          { error: `Product ${productId} was not found` },
          { status: 400 },
        );
      }

      // A line that named a specific variant is charged at that variant. Its
      // GID comes from Mongo, never from the browser, and there is no
      // product-level fallback: that would charge the first variant's price
      // for whatever size the customer actually chose.
      const chosenVariant = resolveChosenVariant(product, item);
      if (chosenVariant.required) {
        if (!chosenVariant.shopifyVariantId) {
          return NextResponse.json(
            {
              error: `"${(product as any).name}"${
                chosenVariant.label ? ` (${chosenVariant.label})` : ""
              } has options that are not synced to Shopify yet, so it cannot be checked out. Open Admin → Settings → Shopify and sync this product.`,
            },
            { status: 400 },
          );
        }
        lines.push({
          merchandiseId: chosenVariant.shopifyVariantId,
          quantity: Math.max(1, Number(item.quantity) || 1),
        });
        continue;
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

    // One basket, one checkout. A made-to-measure line anywhere in it takes the
    // whole basket down the draft-order route, so the customer pays once — the
    // ordinary lines ride along as variant lines and keep Shopify's own prices.
    if (customLines.length) {
      const draft = await createShopifyDraftOrderCheckout(
        [
          ...lines.map((l) => ({
            kind: "variant" as const,
            variantId: l.merchandiseId,
            quantity: l.quantity,
          })),
          ...customLines,
        ],
        {
          email,
          discountCodes: promoCode ? [promoCode] : undefined,
          note: "Linx Square headless checkout (made-to-measure)",
        },
      );

      return NextResponse.json({
        success: true,
        checkoutUrl: draft.invoiceUrl,
        draftOrderId: draft.draftOrderId,
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

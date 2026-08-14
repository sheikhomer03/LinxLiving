import { shopifyAdminRequest } from "./admin";
import type { ShopifyUserError } from "./types";

/**
 * Draft-order checkout — the route for baskets Shopify's Cart API cannot take.
 *
 * A Storefront cart line can only name a ProductVariant, and it is charged at
 * that variant's price. Made-to-measure lines have no variant and no fixed
 * price: the figure comes from the customer's own dimensions (area x rate,
 * assembled bundles, finish upcharges). Those baskets used to be pushed into
 * the site's own checkout, which took payment outside the store that owns the
 * order.
 *
 * A draft order accepts a custom line — free-text title and an explicit unit
 * price — alongside ordinary variant lines, and hands back `invoiceUrl`: a
 * Shopify-hosted checkout. So every basket can now be paid for on Shopify.
 *
 * Trade-off this carries, versus the cart path:
 * - Variant lines are still charged at the variant's own price, set by Shopify.
 * - Custom lines are charged at the price we send. The caller is responsible
 *   for that number being right — see the note in the checkout route.
 */

export type ShopifyDraftLine =
  | { kind: "variant"; variantId: string; quantity: number }
  | {
      kind: "custom";
      title: string;
      /** Unit price ex-VAT, in store currency. */
      unitPrice: number;
      quantity: number;
      sku?: string | null;
      /** Shown on the order in Shopify admin — e.g. the chosen dimensions. */
      attributes?: { key: string; value: string }[];
    };

export type ShopifyDraftOrderResult = {
  draftOrderId: string;
  invoiceUrl: string;
};

const DEFAULT_CURRENCY = process.env.SHOPIFY_CURRENCY?.trim() || "GBP";

const DRAFT_ORDER_CREATE = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        totalPriceSet { shopMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }
`;

/** Money must reach Shopify as a fixed-2dp string, never a float. */
function money(amount: number) {
  return {
    amount: (Math.round(Number(amount) * 100) / 100).toFixed(2),
    currencyCode: DEFAULT_CURRENCY,
  };
}

/**
 * Create a draft order for the basket and return its hosted checkout URL.
 *
 * `visibleToCustomer` and an unsent invoice keep this silent: the customer is
 * redirected to `invoiceUrl` directly, so Shopify must not also email them a
 * "complete your order" invoice for a checkout they are already standing in.
 */
export async function createShopifyDraftOrderCheckout(
  lines: ShopifyDraftLine[],
  options?: {
    email?: string;
    note?: string;
    tags?: string[];
    discountCodes?: string[];
  },
): Promise<ShopifyDraftOrderResult> {
  if (!lines.length) {
    throw new Error("Cart is empty");
  }

  const lineItems = lines.map((line) => {
    if (line.kind === "variant") {
      if (!line.variantId.startsWith("gid://shopify/ProductVariant/")) {
        throw new Error(
          "One or more products are not linked to Shopify. Sync the product first.",
        );
      }
      return {
        variantId: line.variantId,
        quantity: Math.max(1, Number(line.quantity) || 1),
      };
    }

    if (!(Number(line.unitPrice) > 0)) {
      // A £0 custom line would hand the item over for nothing.
      throw new Error(`"${line.title}" has no price, so it cannot be sold.`);
    }
    return {
      title: line.title,
      originalUnitPriceWithCurrency: money(line.unitPrice),
      quantity: Math.max(1, Number(line.quantity) || 1),
      requiresShipping: true,
      taxable: true,
      ...(line.sku ? { sku: line.sku } : {}),
      ...(line.attributes?.length ? { customAttributes: line.attributes } : {}),
    };
  });

  const data = await shopifyAdminRequest<{
    draftOrderCreate: {
      draftOrder: { id: string; invoiceUrl: string | null } | null;
      userErrors: ShopifyUserError[];
    };
  }>(DRAFT_ORDER_CREATE, {
    input: {
      lineItems,
      ...(options?.email ? { email: options.email } : {}),
      ...(options?.note ? { note: options.note } : {}),
      tags: options?.tags?.length ? options.tags : ["linx-made-to-measure"],
      ...(options?.discountCodes?.length
        ? { discountCodes: options.discountCodes }
        : {}),
      // The customer completes this themselves in the hosted checkout.
      allowDiscountCodesInCheckout: true,
      visibleToCustomer: true,
    },
  });

  const result = data.draftOrderCreate;
  if (result?.userErrors?.length) {
    throw new Error(
      result.userErrors.map((e) => e.message).filter(Boolean).join("; ") ||
        "Shopify rejected the draft order",
    );
  }

  const invoiceUrl = result?.draftOrder?.invoiceUrl;
  if (!invoiceUrl) {
    // Without a URL there is nowhere to send the customer, and silently
    // falling back to the site's own checkout is exactly what this replaces.
    throw new Error("Shopify did not return a checkout URL for this basket");
  }

  return { draftOrderId: result!.draftOrder!.id, invoiceUrl };
}

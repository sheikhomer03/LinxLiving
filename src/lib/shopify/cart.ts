import { shopifyStorefrontRequest } from "./storefront";
import { isShopifyCheckoutEnabled as checkoutFlag } from "./config";

export type ShopifyCartLineInput = {
  merchandiseId: string; // ProductVariant GID
  quantity: number;
};

export type ShopifyCartResult = {
  cartId: string;
  checkoutUrl: string;
};

const CART_FRAGMENT = `
  id
  checkoutUrl
  totalQuantity
  cost {
    totalAmount { amount currencyCode }
  }
  lines(first: 100) {
    nodes {
      id
      quantity
      merchandise {
        ... on ProductVariant { id title }
      }
    }
  }
`;

export function isShopifyCheckoutEnabled() {
  return checkoutFlag();
}

/**
 * Country the cart is created for, as an ISO 3166-1 alpha-2 code.
 *
 * Sent on every cart so Shopify resolves the right market. Without it Shopify
 * falls back to the store's default market, and the knock-on effects reach
 * further than pricing: a cart created with no country produced an `/en-us`
 * checkout for a Southampton delivery, and Klarna then opened its **North
 * America** session endpoint (`pay.klarna.com/na/…`), which answered 404
 * because a GBP order has no session in that region. Klarna is unusable
 * without this.
 *
 * Override per deployment if the storefront ever sells outside the UK:
 *
 *   NEXT_PUBLIC_STOREFRONT_COUNTRY=GB
 */
const STOREFRONT_COUNTRY = (
  process.env.NEXT_PUBLIC_STOREFRONT_COUNTRY || "GB"
)
  .trim()
  .toUpperCase();

/**
 * Create a Shopify cart from variant lines and return hosted checkout URL.
 */
export async function createShopifyCheckoutCart(
  lines: ShopifyCartLineInput[],
  options?: {
    email?: string;
    note?: string;
    discountCodes?: string[];
  },
): Promise<ShopifyCartResult> {
  if (!lines.length) {
    throw new Error("Cart is empty");
  }

  for (const line of lines) {
    if (!line.merchandiseId?.startsWith("gid://shopify/ProductVariant/")) {
      throw new Error(
        "One or more products are not linked to Shopify. Sync the product first.",
      );
    }
  }

  const data = await shopifyStorefrontRequest<{
    cartCreate: {
      cart: {
        id: string;
        checkoutUrl: string;
      } | null;
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation CartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `,
    {
      input: {
        lines: lines.map((l) => ({
          merchandiseId: l.merchandiseId,
          quantity: l.quantity,
        })),
        note: options?.note || undefined,
        // Always sent, email or not — the country is what selects the market,
        // and an anonymous cart needs it just as much as an identified one.
        buyerIdentity: {
          countryCode: STOREFRONT_COUNTRY,
          ...(options?.email ? { email: options.email } : {}),
        },
        discountCodes: options?.discountCodes?.length
          ? options.discountCodes
          : undefined,
      },
    },
  );

  if (data.cartCreate.userErrors.length) {
    throw new Error(
      data.cartCreate.userErrors.map((e) => e.message).join("; "),
    );
  }

  const cart = data.cartCreate.cart;
  if (!cart?.checkoutUrl) {
    throw new Error("Shopify did not return a checkout URL");
  }

  return {
    cartId: cart.id,
    checkoutUrl: cart.checkoutUrl,
  };
}

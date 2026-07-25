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
        buyerIdentity: options?.email
          ? { email: options.email }
          : undefined,
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

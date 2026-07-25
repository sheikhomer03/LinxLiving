/**
 * Client-visible flag for Shopify hosted checkout.
 * Server still requires SHOPIFY_CHECKOUT_ENABLED + SHOPIFY_STOREFRONT_ACCESS_TOKEN.
 */
export function isShopifyCheckoutUiEnabled() {
  return process.env.NEXT_PUBLIC_SHOPIFY_CHECKOUT_ENABLED === "true";
}

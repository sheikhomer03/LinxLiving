/**
 * Shopify connection config. Never expose Client Secret / Admin tokens to the client.
 *
 * Auth (2026 Dev Dashboard apps):
 * - Preferred: SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (client credentials grant)
 * - Legacy: SHOPIFY_ADMIN_ACCESS_TOKEN (static shpat_ from old custom apps)
 */

export const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION || "2025-07";

export type ShopifyConfig = {
  storeDomain: string;
  /** Shop subdomain only, e.g. wnbgk0-xu */
  shop: string;
  /** Legacy static Admin token (optional if client credentials are set) */
  adminAccessToken?: string;
  clientId?: string;
  clientSecret?: string;
  storefrontAccessToken: string;
  apiVersion: string;
  /** When true, admin product CRUD also writes to Shopify. */
  syncEnabled: boolean;
  /** When true, storefront product reads prefer Shopify over Mongo. */
  storefrontEnabled: boolean;
  /** When true, storefront uses Shopify Cart + hosted Checkout (not Stripe). */
  checkoutEnabled: boolean;
};

function normalizeDomain(domain: string) {
  return domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function domainToShop(domain: string) {
  return normalizeDomain(domain).replace(/\.myshopify\.com$/i, "");
}

export function getShopifyConfig(): ShopifyConfig | null {
  const storeDomainRaw =
    process.env.SHOPIFY_STORE_DOMAIN?.trim() ||
    process.env.SHOPIFY_SHOP?.trim();
  const adminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const storefrontAccessToken =
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim() || "";

  if (!storeDomainRaw) return null;

  const hasClientCredentials = Boolean(clientId && clientSecret);
  const hasLegacyToken = Boolean(adminAccessToken);
  if (!hasClientCredentials && !hasLegacyToken) return null;

  const storeDomain = normalizeDomain(
    storeDomainRaw.includes(".")
      ? storeDomainRaw
      : `${storeDomainRaw}.myshopify.com`,
  );

  const syncFlag = process.env.SHOPIFY_SYNC_ENABLED;
  const storefrontFlag = process.env.SHOPIFY_STOREFRONT_ENABLED;
  const checkoutFlag = process.env.SHOPIFY_CHECKOUT_ENABLED;

  return {
    storeDomain,
    shop: domainToShop(storeDomain),
    adminAccessToken: adminAccessToken || undefined,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
    storefrontAccessToken,
    apiVersion: SHOPIFY_API_VERSION,
    syncEnabled: syncFlag === undefined ? true : syncFlag === "true",
    storefrontEnabled: storefrontFlag === "true",
    checkoutEnabled:
      checkoutFlag === "true" && Boolean(storefrontAccessToken),
  };
}

export function isShopifyConfigured() {
  return getShopifyConfig() !== null;
}

export function isShopifySyncEnabled() {
  const config = getShopifyConfig();
  return Boolean(config?.syncEnabled);
}

export function isShopifyStorefrontEnabled() {
  const config = getShopifyConfig();
  return Boolean(config?.storefrontEnabled && config.storefrontAccessToken);
}

export function isShopifyCheckoutEnabled() {
  const config = getShopifyConfig();
  return Boolean(config?.checkoutEnabled);
}

export function shopifyAdminGraphqlUrl(config: ShopifyConfig) {
  return `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`;
}

export function shopifyStorefrontGraphqlUrl(config: ShopifyConfig) {
  return `https://${config.storeDomain}/api/${config.apiVersion}/graphql.json`;
}

/**
 * Shared helpers for Shopify ↔ Mongo sync across admin domains.
 */
import { getShopifyConfig } from "./config";

/**
 * Storefront address of a product on the shop domain.
 *
 * Built from the handle rather than read back from Shopify: `onlineStoreUrl` is
 * null until the product is both published and Active, so it is empty for every
 * draft — including the unpriced ranges — while the address itself is stable.
 */
export function shopifyProductUrl(handle?: string | null): string {
  const domain = getShopifyConfig()?.storeDomain;
  const slug = String(handle || "").trim();
  if (!domain || !slug) return "";
  return `https://${domain}/products/${slug}`;
}

export function toShopifyGid(
  resource:
    | "Product"
    | "ProductVariant"
    | "Collection"
    | "Customer"
    | "Order"
    | "DiscountCodeNode"
    | "Menu",
  id: string | number,
) {
  const raw = String(id);
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/${resource}/${raw}`;
}

export function fromShopifyGid(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] || gid;
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Mongo filter: missing Shopify link OR local edits after last successful sync.
 * Pass the Shopify id field name (e.g. shopifyProductId, shopifyCollectionId).
 */
export function needsShopifyOutboundSync(
  shopifyIdField: string,
): Record<string, unknown> {
  return {
    $or: [
      { [shopifyIdField]: null },
      { [shopifyIdField]: { $exists: false } },
      { [shopifyIdField]: "" },
      { shopifySyncedAt: null },
      { shopifySyncedAt: { $exists: false } },
      { $expr: { $gt: ["$updatedAt", "$shopifySyncedAt"] } },
    ],
  };
}

/**
 * Enquiry-only pricing helpers.
 *
 * - Missing / £0 price → "Request a quote" + Contact
 * - SMART / SCHUCO / Cortizo / UK Bifold Door Factory → priced "From £500"
 *   (visible in catalogue) but Add to Cart still goes to Contact
 */

const FROM_PRICE_BRANDS = new Set([
  "smart",
  "schuco",
  "schueco",
  "cortizo",
  "ukbifolddoorfactory",
]);

function normalizeBrandKey(
  brandSlug?: string | null,
  brandName?: string | null,
): string {
  const slug = String(brandSlug || "")
    .toLowerCase()
    .trim();
  if (slug) return slug;
  return String(brandName || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** From-price brands — show "From £N" but do not sell via cart. */
export function isFromPriceBrand(
  brandSlug?: string | null,
  brandName?: string | null,
  priceMode?: string | null,
): boolean {
  if (String(priceMode || "").toLowerCase() === "from") return true;
  return FROM_PRICE_BRANDS.has(normalizeBrandKey(brandSlug, brandName));
}

/** Any product that must not go through normal Add-to-cart checkout. */
export function isPriceOnRequest(
  price: number | null | undefined,
  brandName?: string | null,
  brandSlug?: string | null,
  priceMode?: string | null,
): boolean {
  if (isFromPriceBrand(brandSlug, brandName, priceMode)) return true;
  const n = Number(price);
  return !Number.isFinite(n) || n <= 0;
}

export const PRICE_ON_REQUEST_LABEL = "Request a quote";
export const CONTACT_HREF = "/contact";

/** Storefront price label (cards, PDP, search). */
export function getPriceLabel(
  price: number | null | undefined,
  brandName?: string | null,
  brandSlug?: string | null,
  priceMode?: string | null,
): string {
  const n = Number(price);
  if (isFromPriceBrand(brandSlug, brandName, priceMode) && Number.isFinite(n) && n > 0) {
    const whole = Number.isInteger(n)
      ? n.toLocaleString("en-GB")
      : n.toLocaleString("en-GB", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
    return `From £${whole}`;
  }
  if (!Number.isFinite(n) || n <= 0) return PRICE_ON_REQUEST_LABEL;
  return `£${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Primary CTA copy when the action redirects to Contact. */
export function getEnquiryCtaLabel(
  brandName?: string | null,
  brandSlug?: string | null,
  priceMode?: string | null,
): string {
  if (isFromPriceBrand(brandSlug, brandName, priceMode)) return "Add to Cart";
  return "Request a quote";
}

export type SampleRequestProduct = {
  id: string;
  name: string;
  sku?: string | null;
  productCode?: string | null;
  brandName?: string | null;
  category?: string | null;
  categoryName?: string | null;
  price?: number | null;
};

/** Build /contact URL that prefills the enquiry form for a sample request. */
export function buildSampleRequestHref(product: SampleRequestProduct): string {
  const params = new URLSearchParams();
  params.set("intent", "sample");
  if (product.id) params.set("productId", product.id);
  if (product.name) params.set("productName", product.name);
  const code = product.sku || product.productCode;
  if (code) params.set("sku", code);
  if (product.brandName) params.set("brand", product.brandName);
  if (product.categoryName || product.category) {
    params.set("category", product.categoryName || product.category || "");
  }
  if (product.price != null && Number(product.price) > 0) {
    params.set("price", String(product.price));
  }
  return `${CONTACT_HREF}?${params.toString()}`;
}

/** Build /contact URL for quote / from-price "Add to Cart" enquiries. */
export function buildContactEnquiryHref(product: {
  id?: string;
  name?: string;
  brandName?: string | null;
  category?: string | null;
  price?: number | null;
}): string {
  const params = new URLSearchParams();
  params.set("intent", "enquiry");
  if (product.name) params.set("product", product.name);
  if (product.id) params.set("ref", product.id);
  if (product.brandName) params.set("brand", product.brandName);
  if (product.category) params.set("category", product.category);
  if (product.price != null && Number(product.price) > 0) {
    params.set("price", String(product.price));
  }
  return `${CONTACT_HREF}?${params.toString()}`;
}

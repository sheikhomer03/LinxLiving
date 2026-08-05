/** Any product with missing / £0 price is enquiry-only (quote + Contact). */
export function isPriceOnRequest(
  price: number | null | undefined,
  _brandName?: string | null,
  _brandSlug?: string | null,
): boolean {
  const n = Number(price);
  return !Number.isFinite(n) || n <= 0;
}

export const PRICE_ON_REQUEST_LABEL = "Request a quote";
export const CONTACT_HREF = "/contact";

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
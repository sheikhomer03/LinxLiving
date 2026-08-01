/** Any product with missing / £0 price is enquiry-only (TBC + Contact). */
export function isPriceOnRequest(
  price: number | null | undefined,
  _brandName?: string | null,
  _brandSlug?: string | null,
): boolean {
  const n = Number(price);
  return !Number.isFinite(n) || n <= 0;
}

export const PRICE_ON_REQUEST_LABEL = "TBC";
export const CONTACT_HREF = "/contact";

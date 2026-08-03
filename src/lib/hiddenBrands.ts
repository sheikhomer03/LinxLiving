/**
 * Brands temporarily hidden from the storefront.
 *
 * Listed slugs are filtered out of the navbar, homepage brand showcase,
 * category/catalogue filters and department navigation. The brand and its
 * products stay intact in the database and remain fully visible in the admin
 * area, so hiding is non-destructive and reversible.
 *
 * To bring a brand back, remove its slug from this array — nothing else.
 */
export const HIDDEN_BRAND_SLUGS: string[] = [
  "sterlingbuild",
];

/** True when a brand slug is hidden from the storefront. */
export function isHiddenBrandSlug(slug?: string | null): boolean {
  if (!slug) return false;
  return HIDDEN_BRAND_SLUGS.includes(String(slug).trim().toLowerCase());
}

/** Drop hidden brands from a list of objects carrying a `slug`. */
export function filterHiddenBrands<T extends { slug?: string | null }>(
  brands: T[],
): T[] {
  return (brands || []).filter((b) => !isHiddenBrandSlug(b?.slug));
}

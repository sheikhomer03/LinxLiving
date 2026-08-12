/**
 * Extra brand slugs forced off the storefront (in addition to admin
 * Status = Hidden / `isActive: false`).
 *
 * Listed slugs are filtered out of the navbar, homepage brand showcase,
 * category/catalogue filters and department navigation. The brand and its
 * products stay intact in the database and remain fully visible in the admin
 * area, so hiding is non-destructive and reversible.
 *
 * Prefer toggling Status to Hidden in Admin → Brands. Use this list only for
 * emergency hard-hides that should survive an accidental Active toggle.
 */
export const HIDDEN_BRAND_SLUGS: string[] = [
  // Hidden from the storefront only — the brand and its 208 products stay in
  // the database and remain fully editable in admin. Remove this line to
  // bring Britmet back.
  "britmet",
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

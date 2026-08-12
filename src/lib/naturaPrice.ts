/**
 * Natura Flooring is sold / displayed by the m².
 * `product.price` is the Shopify pack price; `specs.pricePerM2` is the
 * storefront rate (already includes any Linx markup, e.g. +40%).
 */

export function isNaturaFlooringBrand(
  brandSlug?: string | null,
  brandName?: string | null,
  specs?: Record<string, unknown> | null,
): boolean {
  if (String(brandSlug || "").toLowerCase() === "natura-flooring") return true;
  if (/^natura\b/i.test(String(brandName || "").trim())) return true;
  const source = String(specs?.source || "").toLowerCase();
  if (source === "natura-flooring-scrape") return true;
  if (specs?.naturaHandle || specs?.naturaId) return true;
  return false;
}

/** £/m² to show for Natura, or null when the product is not Natura / has no rate. */
export function resolveNaturaPricePerM2(input: {
  brandSlug?: string | null;
  brandName?: string | null;
  pricePerM2?: number | string | null;
  specs?: Record<string, unknown> | null;
}): number | null {
  if (
    !isNaturaFlooringBrand(input.brandSlug, input.brandName, input.specs)
  ) {
    return null;
  }

  const candidates = [
    input.pricePerM2,
    input.specs?.pricePerM2,
    input.specs?.pricePerSqm,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

/**
 * List/search/card unit price. Natura uses its own £/m² resolution; any
 * other supplier that also carries an explicit £/m² spec (e.g. Otto Tiles)
 * uses it too, matching how the product detail page resolves price —
 * otherwise the box price gets shown mislabelled as a per-m² rate.
 */
export function resolveStorefrontUnitPrice(input: {
  price: number;
  brandSlug?: string | null;
  brandName?: string | null;
  pricePerM2?: number | string | null;
  specs?: Record<string, unknown> | null;
}): { price: number; perSqm: boolean } {
  const m2 = resolveNaturaPricePerM2(input);
  if (m2 != null) return { price: m2, perSqm: true };
  const explicit = Number(input.pricePerM2 ?? input.specs?.pricePerM2);
  if (Number.isFinite(explicit) && explicit > 0) {
    return { price: Math.round(explicit * 100) / 100, perSqm: true };
  }
  return { price: Number(input.price) || 0, perSqm: false };
}

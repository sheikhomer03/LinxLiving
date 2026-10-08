/**
 * Product slugs — the name-based address every storefront link uses:
 * `/products/costa-green` instead of `/products/<database id>`.
 *
 * Stored on the product (`Product.slug`), unique across both clusters, and
 * never changed once set, so a shared link keeps working after a rename.
 * Internal records — orders, reviews, cart lines, Shopify, admin — still use
 * the database id; only what a shopper opens or shares goes by slug.
 *
 * The rules, shared by the backfill script (scripts/backfill-product-slugs.cjs
 * mirrors them) and by new products (assignProductSlug):
 *
 *   1. base: the name, lowercased, accents dropped, `&` → `and`, `×` → `x`,
 *      anything else → `-`, cut to ≤ 150 characters at a `-`.
 *   2. Free → base.
 *   3. Taken by another product of the same name → base + `-` + supplier SKU.
 *   4. Still taken (same SKU, or no SKU) → `-2`, `-3`, … in creation order.
 *   5. Never 24 hex characters, so a slug is never mistaken for an id.
 *
 * Pure functions only: safe in client components.
 */

export const PRODUCT_SLUG_MAX_BASE = 150;
export const PRODUCT_SLUG_MAX_SKU = 30;

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** True for a 24-hex database id — an old `/products/<id>` link. */
export function isObjectIdLike(value: string): boolean {
  return OBJECT_ID.test(value);
}

/** Anything → lowercase words joined by `-`. */
export function slugifyText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/×/g, "x")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Cut to `max` characters, at a word break when one is near the end. */
function cutAtWord(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastBreak = cut.lastIndexOf("-");
  return (lastBreak >= max * 0.6 ? cut.slice(0, lastBreak) : cut).replace(
    /-+$/g,
    "",
  );
}

/** Rule 1: the name part of the slug. Never empty. */
export function productSlugBase(name: unknown): string {
  return cutAtWord(slugifyText(name), PRODUCT_SLUG_MAX_BASE) || "product";
}

type SkuSource = {
  supplierSku?: unknown;
  sourceSku?: unknown;
  manufacturerSku?: unknown;
  productCode?: unknown;
  linxSku?: unknown;
};

/** Rule 3: the product's own code, slugified — "" when it has none. */
export function productSlugSku(product: SkuSource): string {
  const raw = [
    product.supplierSku,
    product.sourceSku,
    product.manufacturerSku,
    product.productCode,
    product.linxSku,
  ].find((v) => String(v ?? "").trim());
  return cutAtWord(slugifyText(raw), PRODUCT_SLUG_MAX_SKU);
}

/**
 * Rules 2–5 as an ordered list of candidates: the first one no other
 * product holds is the slug. `withSku` puts the SKU form first — the
 * backfill does that for every name shared by more than one product.
 */
export function* productSlugCandidates(
  base: string,
  sku: string,
  withSku = false,
): Generator<string> {
  const stem = sku ? `${base}-${sku}` : base;
  const seen = new Set<string>();
  const ok = (s: string) => !seen.has(s) && !isObjectIdLike(s) && seen.add(s);
  if (!withSku && ok(base)) yield base;
  if (ok(stem)) yield stem;
  for (let n = 2; ; n++) {
    const numbered = `${stem}-${n}`;
    if (ok(numbered)) yield numbered;
  }
}

/** A product's storefront address. Falls back to the id until it has a slug. */
export function productHref(product: {
  slug?: unknown;
  _id?: unknown;
  id?: unknown;
}): string {
  const slug = String(product.slug ?? "").trim();
  if (slug) return `/products/${slug}`;
  return `/products/${String(product.id ?? product._id ?? "")}`;
}

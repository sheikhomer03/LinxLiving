/**
 * Strip database bookkeeping from navigation payloads.
 *
 * The brand and department trees are serialised into the RSC payload of every
 * page. Each carries ~2,500 menu nodes, and each node was shipping its full
 * Mongo document — createdAt, updatedAt, shopifySyncedAt, shopifyCollectionId,
 * __v — none of which any component reads. On a product page that was most of
 * a 1.7 MB response.
 *
 * This drops those keys only. Every field the navbar, footer and catalogue
 * actually use (name, slug, image, children, brand, order, level, subBrands,
 * pricedBrandIds, …) is left untouched, so nothing renders differently.
 */
const DROP = new Set([
  "createdAt",
  "updatedAt",
  "shopifySyncedAt",
  "shopifyCollectionId",
  "shopifyProductId",
  "__v",
  // A menu node's `shopifyImageUrl` is a verbatim copy of its `image` — the
  // mega menu reads `image`, and no client component anywhere reads
  // `shopifyImageUrl`. It was still the single most expensive key in the
  // homepage payload at ~260 KB across 2,023 nodes. (Product *variants* also
  // carry a `shopifyImageUrl`, which productImage.ts does read — those never
  // pass through here, only menu/department/brand trees do.)
  "shopifyImageUrl",
]);

export function stripNavMeta<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripNavMeta(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP.has(k)) continue;
      out[k] = stripNavMeta(v);
    }
    return out as unknown as T;
  }
  return value;
}

import { fedFind, locateProduct, locateProductBy } from "@/lib/mongoCluster";
import {
  productSlugBase,
  productSlugCandidates,
  productSlugSku,
} from "@/lib/productSlug";

/** Duplicate key — the unique slug index rejected a slug taken meanwhile. */
const isDuplicateKey = (e: unknown) =>
  (e as { code?: number } | null)?.code === 11000;

/**
 * Give one product its slug, if it has none, and return it.
 *
 * Used where a product is created (admin, Shopify inbound) and when an old
 * `/products/<id>` link reaches a product imported since the last backfill.
 * The first product with a name takes the plain name; later ones get the
 * SKU form, then a number — see @/lib/productSlug for the rules.
 *
 * A slug already set is returned untouched: slugs never change. The write
 * only lands where `slug` is still missing, so two requests racing for the
 * same product cannot each give it a different one.
 */
export async function assignProductSlug(
  productId: string,
): Promise<string | null> {
  const held = await locateProduct(productId);
  if (!held) return null;

  const doc = (await held.model
    .findById(productId)
    .select(
      "name slug supplierSku sourceSku manufacturerSku productCode linxSku",
    )
    .lean()) as Record<string, unknown> | null;
  if (!doc) return null;
  const existing = String(doc.slug ?? "").trim();
  if (existing) return existing;

  const base = productSlugBase(doc.name);
  const sku = productSlugSku(doc);

  let tries = 0;
  for (const candidate of productSlugCandidates(base, sku)) {
    if (++tries > 500) break;
    const taken = await locateProductBy({
      slug: candidate,
      _id: { $ne: doc._id },
    });
    if (taken) continue;
    try {
      const res = await held.model.updateOne(
        { _id: doc._id, slug: { $in: [null, ""] } },
        { $set: { slug: candidate } },
      );
      if (res.matchedCount === 0) {
        // Someone else set it first; theirs stands.
        const now = (await held.model
          .findById(doc._id)
          .select("slug")
          .lean()) as { slug?: string } | null;
        return now?.slug || null;
      }
      return candidate;
    } catch (e) {
      if (isDuplicateKey(e)) continue;
      throw e;
    }
  }
  console.error("assignProductSlug: no free slug for", productId);
  return null;
}

/** The product whose slug this is, from whichever cluster holds it. */
export async function findProductBySlug<T = Record<string, unknown>>(
  slug: string,
): Promise<T | null> {
  if (!slug) return null;
  const rows = await fedFind<T>(
    (M) => M.find({ slug }).limit(1).lean() as Promise<T[]>,
  );
  return rows[0] ?? null;
}

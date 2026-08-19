/**
 * Brand + category (or subcategory) pairs that have at least one priced
 * storefront product. Used to hide empty / unpriced accessory ranges from
 * the navbar Accessories mega menu (e.g. Noken accessories at £0).
 */
import { unstable_cache } from "next/cache";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { storefrontVisibilityClause } from "@/lib/pricedOnly";

/** Keys shaped as `${brandObjectId}::${categoryOrSubSlug}`. */
export async function getPricedBrandCategoryKeys(): Promise<Set<string>> {
  const keys = await cachedPricedBrandCategoryKeys();
  return new Set(keys);
}

const cachedPricedBrandCategoryKeys = unstable_cache(
  async () => {
    await connectDB();
    const priced = storefrontVisibilityClause();
    const { getExcludedStorefrontBrandIds } = await import(
      "@/lib/excludedStorefrontBrands"
    );
    const excluded = await getExcludedStorefrontBrandIds();
    const base = {
      ...priced,
      brand: {
        $exists: true,
        $nin: [null, "", ...excluded],
      },
    };

    const [byCat, bySub] = await Promise.all([
      Product.aggregate<{ _id: { b: unknown; c: string }; n: number }>([
        {
          $match: {
            ...base,
            category: { $exists: true, $nin: [null, ""] },
          },
        },
        {
          $group: {
            _id: { b: "$brand", c: "$category" },
            n: { $sum: 1 },
          },
        },
      ]),
      Product.aggregate<{ _id: { b: unknown; c: string }; n: number }>([
        {
          $match: {
            ...base,
            subCategory: { $exists: true, $nin: [null, ""] },
          },
        },
        {
          $group: {
            _id: { b: "$brand", c: "$subCategory" },
            n: { $sum: 1 },
          },
        },
      ]),
    ]);

    const keys: string[] = [];
    for (const row of [...byCat, ...bySub]) {
      if (!(row.n > 0)) continue;
      const b = row._id?.b != null ? String(row._id.b) : "";
      const c = row._id?.c != null ? String(row._id.c).trim() : "";
      if (b && c) keys.push(`${b}::${c}`);
    }
    return keys;
  },
  ["priced-brand-category-keys-v2"],
  { revalidate: 120, tags: ["navigation"] },
);

export function brandCategoryKey(brandId: string, slug: string): string {
  return `${String(brandId)}::${String(slug || "").trim()}`;
}

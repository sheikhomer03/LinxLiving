/**
 * Brands excluded from the storefront (navbar, catalogue, product listings):
 * - Admin status Hidden (`isActive: false`)
 * - Slugs listed in HIDDEN_BRAND_SLUGS
 *
 * Admin still sees and edits these brands and their products.
 */
import { unstable_cache } from "next/cache";
import connectDB from "@/lib/mongodb";

/** Cached string ObjectIds of brands hidden from the storefront. */
export async function getExcludedStorefrontBrandIdStrings(): Promise<string[]> {
  return cachedExcludedStorefrontBrandIdStrings();
}

/** Same IDs as ObjectId instances for Mongo `$nin` queries. */
export async function getExcludedStorefrontBrandIds(): Promise<unknown[]> {
  const ids = await getExcludedStorefrontBrandIdStrings();
  if (!ids.length) return [];
  const mongoose = await import("mongoose");
  return ids
    .map((id) => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const cachedExcludedStorefrontBrandIdStrings = unstable_cache(
  async () => {
    await connectDB();
    const { Brand } = await import("@/models/Brand");
    const { HIDDEN_BRAND_SLUGS } = await import("@/lib/hiddenBrands");
    const rows = await Brand.find({
      $or: [
        { isActive: false },
        ...(HIDDEN_BRAND_SLUGS.length
          ? [{ slug: { $in: HIDDEN_BRAND_SLUGS } }]
          : []),
      ],
    })
      .select("_id")
      .lean();
    return rows.map((b: any) => String(b._id));
  },
  ["excluded-storefront-brand-ids-v4"],
  { revalidate: 120, tags: ["navigation"] },
);

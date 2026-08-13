import CategoryPage from "@/components/layout/CategoryTemplate";
import { getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getStoreName } from "@/app/actions/settings";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shop Catalogue | Linx Square",
  description:
    "Browse our full catalogue of architectural tiles, stone, and finishes. Filter by category, brand, price, and sort to find the right materials for your project.",
  alternates: {
    canonical: "/category",
  },
};

/**
 * Fast shell only — brand/department trees are cached (~5 min).
 * Products + facet counts load client-side with in-page loaders so the
 * route paints immediately on navbar clicks.
 */
export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, brandRes, deptRes, storeName] = await Promise.all([
    searchParams,
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  // Every navbar department/category/brand click lands here via
  // /category?department=... (see catalogueHref in Navbar) rather than on
  // /category/[slug] — so a filtered visit must behave like browsing a
  // specific category (price low-to-high), and only the bare, unfiltered
  // /category landing keeps the "newest" merchandising default.
  const hasBrowsingFilter = Boolean(
    sp.category ||
      sp.finish ||
      sp.department ||
      sp.subcategory ||
      sp.brand ||
      sp.subBrand ||
      sp.onSale ||
      sp.sale ||
      sp.search ||
      sp.q,
  );

  return (
    <CategoryPage
      slug="all"
      browseAll
      defaultSort={hasBrowsingFilter ? undefined : "newest"}
      title="Catalogue"
      description="Browse our full catalogue of architectural tiles, stone, and finishes. Filter by category, brand, price, and sort to find the right materials for your project."
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
    />
  );
}

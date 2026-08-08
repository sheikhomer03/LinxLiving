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
export default async function CataloguePage() {
  const [brandRes, deptRes, storeName] = await Promise.all([
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  return (
    <CategoryPage
      slug="all"
      browseAll
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
    />
  );
}

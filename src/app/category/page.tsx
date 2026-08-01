import CategoryPage from "@/components/layout/CategoryTemplate";
import {
  getCatalogFacetCounts,
  getPublicProducts,
} from "@/app/actions/products";
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

export default async function CataloguePage() {
  const [productsResult, brandRes, deptRes, storeName] = await Promise.all([
    getPublicProducts({
      limit: 12,
      sort: "newest",
      fields:
        "name price images category subCategory stock shopifyVariantId specs brand",
    }),
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  const brands = (brandRes.brands || []).map((b: any) => {
    const categorySlugs: string[] = [];
    for (const menu of b.menus || []) {
      categorySlugs.push(menu.slug, menu.name);
      for (const child of menu.children || []) {
        categorySlugs.push(child.slug, child.name);
      }
    }
    return {
      slug: b.slug,
      name: b.name,
      categorySlugs: [...new Set(categorySlugs.filter(Boolean))],
    };
  });

  const categories = (brandRes.brands || []).flatMap((b: any) =>
    (b.menus || [])
      .filter((m: any) => !m.parent)
      .map((m: any) => ({ slug: m.slug, name: m.name })),
  );

  const facetCounts = await getCatalogFacetCounts({ brands, categories });

  return (
    <CategoryPage
      title="Catalogue"
      description="Explore our full range of architectural materials — filter by category, brand, and price to find what you need."
      slug="all"
      browseAll
      initialProducts={productsResult}
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
      initialFacetCounts={facetCounts}
    />
  );
}

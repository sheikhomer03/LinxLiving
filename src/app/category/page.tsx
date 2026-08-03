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

function parseList(value?: string | string[] | null): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(",") : String(value);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    category?: string;
    finish?: string;
    subcategory?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const brandSlugs = parseList(params.brand);
  const categorySlugs = parseList(params.category || params.finish);
  const subCategory = params.subcategory?.trim() || undefined;
  const sort = params.sort || "newest";
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);

  const [brandRes, deptRes, storeName] = await Promise.all([
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  const brands = (brandRes.brands || []).map((b: any) => {
    const categorySlugsForBrand: string[] = [];
    for (const menu of b.menus || []) {
      categorySlugsForBrand.push(menu.slug, menu.name);
      for (const child of menu.children || []) {
        categorySlugsForBrand.push(child.slug, child.name);
      }
    }
    return {
      slug: b.slug,
      name: b.name,
      categorySlugs: [...new Set(categorySlugsForBrand.filter(Boolean))],
    };
  });

  const categories = (brandRes.brands || []).flatMap((b: any) =>
    (b.menus || [])
      .filter((m: any) => !m.parent)
      .map((m: any) => ({ slug: m.slug, name: m.name })),
  );

  const [productsResult, facetCounts] = await Promise.all([
    getPublicProducts({
      limit: 12,
      page,
      sort,
      brand: brandSlugs.length ? brandSlugs : undefined,
      category: categorySlugs.length ? categorySlugs : undefined,
      subCategory,
      fields:
        "name price images category subCategory stock shopifyVariantId specs brand",
    }),
    getCatalogFacetCounts({
      brands,
      categories,
      brand: brandSlugs.length ? brandSlugs : undefined,
    }),
  ]);

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

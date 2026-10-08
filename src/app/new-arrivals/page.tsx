import CategoryPage from "@/components/layout/CategoryTemplate";
import { getPublicProducts } from "@/app/actions/products";
import { getBrandFacetTree } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getStoreName } from "@/app/actions/settings";
import type { Metadata } from "next";

/*
 * Rendered per request, as before. The root layout no longer reads the
 * session (so storefront pages can be cached), which would otherwise let Next
 * cache this route too — and there is nothing to gain from caching a page
 * that is personal or part of an order.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New Arrivals | Latest Luxury Architectural Surfaces",
  description:
    "Stay ahead of design trends. Explore our newest architectural surface materials and luxury bathroom collections freshly added to our boutique.",
  alternates: {
    canonical: "/new-arrivals",
  },
};

export default async function NewArrivalsPage() {
  const [productsResult, brandRes, deptRes, storeName] = await Promise.all([
    getPublicProducts({
      limit: 36,
      sort: "newest",
      fields: "slug name price images shopifyImages category department stock",
    }),
    getBrandFacetTree(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  return (
    <CategoryPage
      title="New Arrivals"
      description="Explore our latest architectural surface materials and luxury bathroom collections."
      slug="all"
      defaultSort="newest"
      initialProducts={productsResult}
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
    />
  );
}

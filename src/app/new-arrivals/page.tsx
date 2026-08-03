import CategoryPage from "@/components/layout/CategoryTemplate";
import { getPublicProducts } from "@/app/actions/products";
import { getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getStoreName } from "@/app/actions/settings";
import type { Metadata } from "next";

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
      limit: 12,
      sort: "newest",
      fields: "name price images category stock",
    }),
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  return (
    <CategoryPage
      title="New Arrivals"
      description="Explore our latest architectural surface materials and luxury bathroom collections."
      slug="all"
      initialProducts={productsResult}
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
    />
  );
}

import CategoryPage from "@/components/layout/CategoryTemplate";
import { getMenuBySlug, getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getStoreName } from "@/app/actions/settings";
import { Metadata } from "next";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const menu = await getMenuBySlug(slug);
  if (!menu) return { title: "Category Not Found" };

  return {
    title: `${menu.name} | Linx Square`,
    description: `Explore our collection of ${menu.name}. Premium architectural materials and luxury surfaces for refined living.`,
    alternates: {
      canonical: `/category/${slug}`,
    },
  };
}

/**
 * Fast shell — menu + nav from cache. Product grid loads client-side
 * so navigation from the navbar is immediate.
 */
export default async function DynamicCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [menu, brandRes, deptRes, storeName] = await Promise.all([
    getMenuBySlug(slug),
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  if (!menu) {
    notFound();
  }

  return (
    <CategoryPage
      title={menu.name}
      description={`Discover our exclusive range of ${menu.name}, curated for luxury architectural projects.`}
      slug={menu.slug}
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
    />
  );
}

import CategoryPage from "@/components/layout/CategoryTemplate";
import {
  getMenuBySlug,
  getBrandMenuTrees,
} from "@/app/actions/admin";
import {
  getCatalogFacetCounts,
  getPublicProducts,
} from "@/app/actions/products";
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

export default async function DynamicCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [menu, productsResult, brandRes, deptRes, storeName] = await Promise.all([
    getMenuBySlug(slug),
    getPublicProducts({
      category: slug,
      limit: 12,
      sort: "newest",
      fields:
        "name price images category subCategory stock shopifyVariantId specs brand",
    }),
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  if (!menu) {
    notFound();
  }

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
      title={menu.name}
      description={`Discover our exclusive range of ${menu.name}, curated for luxury architectural projects.`}
      slug={menu.slug}
      initialProducts={productsResult}
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
      initialFacetCounts={facetCounts}
    />
  );
}

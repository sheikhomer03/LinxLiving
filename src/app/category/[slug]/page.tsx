import CategoryPage from "@/components/layout/CategoryTemplate";
import { getPublicProducts } from "@/app/actions/products";
import { buildListingQuery } from "@/lib/listingQuery";
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
 * Fast shell — menu + nav from cache — with the grid's first page rendered
 * into it, for the reason /category's own comment gives: a shell that paints
 * instantly and then waits on hydration before it can even ask for products
 * shows an empty page for the part the customer came for.
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

  // No query string on this route, so the browser's derivation and this one
  // cannot disagree — the slug is the category and nothing needs remapping.
  const { query } = buildListingQuery({ searchKey: "", slug: menu.slug });
  const initialProducts = await getPublicProducts(query);

  return (
    <CategoryPage
      title={menu.name}
      slug={menu.slug}
      initialProducts={initialProducts}
      initialProductsKey=""
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
    />
  );
}

import CategoryPage from "@/components/layout/CategoryTemplate";
import { getPublicProducts } from "@/app/actions/products";
import { buildListingQuery } from "@/lib/listingQuery";
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
 * Fast shell, with the first page of products already in it.
 *
 * The shell alone painted quickly but stayed empty: nothing could ask for
 * products until the bundle had downloaded and hydrated, which put the query
 * behind about a second of dead time and the first card past three seconds.
 * Running the same query here overlaps it with the render instead, and the
 * grid arrives in the HTML.
 *
 * Facet counts still load client-side — they are not what the customer is
 * waiting to see, and they do not block the grid.
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

  const searchKey = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]],
    ),
  ).toString();

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

  // A single `?category=` value can be a parent or a child menu, and only the
  // menu tree the browser builds from the facet counts can tell which. Hand
  // that case to the client rather than render a grid that may be wrong.
  const { query, needsMenuRemap } = buildListingQuery({
    searchKey,
    slug: "all",
    browseAll: true,
    defaultSort: hasBrowsingFilter ? undefined : "newest",
  });
  const initialProducts = needsMenuRemap
    ? undefined
    : await getPublicProducts(query);

  return (
    <CategoryPage
      slug="all"
      browseAll
      defaultSort={hasBrowsingFilter ? undefined : "newest"}
      initialProducts={initialProducts}
      initialProductsKey={initialProducts ? searchKey : undefined}
      title="Catalogue"
      description="Browse our full catalogue of architectural tiles, stone, and finishes. Filter by category, brand, price, and sort to find the right materials for your project."
      initialBrandMenus={brandRes.brands || []}
      initialDepartments={deptRes.departments || []}
      initialStoreName={storeName}
    />
  );
}

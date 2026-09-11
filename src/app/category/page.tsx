import CategoryPage from "@/components/layout/CategoryTemplate";
import {
  CatalogueIndex,
  type CatalogueIndexItem,
} from "@/components/category/CatalogueIndex";
import { getListingFirstPage } from "@/lib/cachedListing";
import { buildListingQuery } from "@/lib/listingQuery";
import { getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getStoreName } from "@/app/actions/settings";
import { sanitizeDisplayImageUrl } from "@/lib/productImage";
import type { Metadata } from "next";

/** Photograph behind the index banner. */
const INDEX_BANNER = "/home/hero/bathroom-tiles.png";

/** First usable image in a category subtree — parents often carry none. */
function firstImage(node: {
  image?: string;
  children?: { image?: string; children?: unknown[] }[];
}): string {
  const own = sanitizeDisplayImageUrl(node.image || "");
  if (own) return own;
  for (const child of node.children || []) {
    const found = firstImage(child as never);
    if (found) return found;
  }
  return "";
}

type CategoryNode = {
  name: string;
  slug: string;
  image?: string;
  children?: CategoryNode[];
};

/**
 * Menu labels are decorated in the data — "▣ All Accessories" carries a
 * U+25A3 and a space before the words. The glyph is a cue for a dense menu
 * list and reads as a stray mark on a photograph, so it comes off before the
 * name is either tested or displayed.
 */
function cleanName(name: string): string {
  return name.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

/**
 * Menu scaffolding that is not a category.
 *
 * The tree carries navigation groupings alongside real categories — "All
 * Accessories", "Accessories by Brand", "Accessories by Type" — and their
 * images are grey placeholder graphics with the words "By Brand" / "By Type"
 * drawn on them. On a listing they read as headings; in a grid of
 * photographs they read as broken cards.
 */
function isGroupingNode(name: string): boolean {
  return (
    /^(all|shop)\s/i.test(name) ||
    /\bby\s+(brand|type|size|colou?r)\b/i.test(name)
  );
}

/**
 * Every category we can photograph, A–Z, as index cards.
 *
 * Drawn from both trees. Department categories alone came to 32 — three
 * rows, with a Load More button that had nothing left to load — because the
 * depth of this catalogue lives in the brand menus (Chevron, Herringbone,
 * Mosaics, Solid Blocks and the rest). The reference index is 370 entries
 * listed at exactly that granularity, so both trees are walked to the
 * bottom.
 *
 * Deduped by **name**, not slug. The same category reaches us under more
 * than one department, under more than one brand, and occasionally under
 * more than one slug — `accessories` and `mb-accessories` are both called
 * "Accessories" — and the reference index never prints a name twice.
 *
 * A card in this layout *is* a photograph, so one without an image would be
 * a grey square with a caption. Those are dropped; they stay reachable from
 * the mega menu.
 */
function indexItems(
  departments: { slug: string; categories?: CategoryNode[] }[],
  brands: { slug: string; menus?: CategoryNode[] }[],
): CatalogueIndexItem[] {
  const byName = new Map<string, CatalogueIndexItem>();

  const add = (node: CategoryNode, scope: string) => {
    const slug = String(node.slug || "").trim();
    const name = cleanName(String(node.name || ""));
    if (slug && name && !isGroupingNode(name)) {
      const key = name.toLowerCase();
      const image = firstImage(node);
      const existing = byName.get(key);
      if (image && !existing) {
        byName.set(key, {
          slug,
          name,
          image,
          href: `/category?${scope}&category=${encodeURIComponent(slug)}`,
        });
      }
    }
    for (const child of node.children || []) add(child, scope);
  };

  // Departments first, so a category that appears in both trees keeps the
  // broader department link rather than being pinned to one supplier.
  for (const dept of departments || []) {
    const scope = `department=${encodeURIComponent(dept.slug)}`;
    for (const cat of dept.categories || []) add(cat, scope);
  }
  for (const brand of brands || []) {
    const scope = `brand=${encodeURIComponent(brand.slug)}`;
    for (const menu of brand.menus || []) add(menu, scope);
  }

  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { numeric: true }),
  );
}

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

  /*
   * The bare URL is the index; anything with a query string is the listing.
   *
   * Every navbar link, facet and sort lands here carrying parameters, so this
   * one test keeps all of them on the product grid while /category itself
   * becomes the directory of categories.
   */
  if (Object.keys(sp).length === 0) {
    return (
      <CatalogueIndex
        items={indexItems(deptRes.departments || [], brandRes.brands || [])}
        heading="Departments"
        bannerImage={INDEX_BANNER}
        storeName={storeName}
      />
    );
  }

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
    : await getListingFirstPage(query);

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
      navbarInLayout
    />
  );
}

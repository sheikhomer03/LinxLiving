/**
 * The catalogue listing query, derived from a URL.
 *
 * The listing used to build this only in the browser, which is why a category
 * page shipped no products: nothing could ask for them until React had
 * hydrated. Deriving it here lets the server run the same query while it
 * renders the shell, and lets the client re-derive the identical query when a
 * filter changes — one rule, not two that have to be kept in step.
 *
 * `categorySlug` and `subCategory` are the only parts that need the menu tree,
 * because a `?category=` value can be either a parent or a child menu and the
 * query takes them in different arguments. `needsMenuRemap` says when that
 * applies, so a caller without the tree (the server, which only has it after
 * the facet counts it does not wait for) can tell whether its answer would
 * differ from the browser's, and hand off rather than guess.
 */

/** What ProductCard and the listing grid actually read off a product. */
export const LISTING_FIELDS = [
  "name",
  "price",
  "images",
  "shopifyImages",
  "category",
  "subCategory",
  "department",
  "stock",
  "shopifyVariantId",
  "brand",
  "subBrand",
  "vatRate",
  "colorOptions",
  // Named one by one rather than the whole `specs` object: specs averages 900
  // bytes a product here and carries scrape bookkeeping (sourceUrl, handles,
  // timestamps) that no card reads — a third of the listing payload for
  // nothing. The keys below are every one the grid or ProductCard touches,
  // including the four `hasPaidSampleFlow` checks.
  "specs.salePercent",
  "specs.salePriceMode",
  "specs.compareAtPrice",
  "specs.shopifyCompareAt",
  "specs.priceDisplay",
  "specs.pricePerM2",
  "specs.size",
  "specs.samplePrice",
  "specs.source",
  "specs.ottoId",
  "specs.ottoHandle",
].join(" ");

export const LISTING_PAGE_SIZE = 36;

export type ListingQuery = {
  category?: string | string[];
  subCategory?: string;
  size?: string[];
  brand?: string[];
  subBrand?: string[];
  department?: string[];
  colour?: string[];
  style?: string[];
  range?: string[];
  minPrice?: number;
  maxPrice?: number;
  sort: string;
  search?: string;
  page: number;
  limit: number;
  onSale?: boolean;
  requireImages: true;
  fields: string;
};

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildListingQuery(input: {
  /** The URL's query string, or anything URLSearchParams accepts. */
  searchKey: string | URLSearchParams;
  /** Route slug — "all" on the catalogue landing. */
  slug: string;
  browseAll?: boolean;
  defaultSort?: string;
  /** Child menu slug → its parent, when the menu tree is available. */
  childToParent?: Map<string, string>;
  /** Slugs known to be parent menus, when the menu tree is available. */
  parentSlugSet?: Set<string>;
  /**
   * Top-level category slugs of the department being browsed.
   *
   * A slug can be a top-level category here and a child menu under some
   * brand's tree at the same time — Bathrooms lists `sanitaryware` as one of
   * its nine categories while a brand files it beneath `bathrooms`. Rewriting
   * it to parent + sub then asks for a sub-category no product carries, and
   * the page comes back empty. Known top-level categories are left alone.
   */
  topLevelCategories?: Set<string>;
}): { query: ListingQuery; needsMenuRemap: boolean } {
  const {
    searchKey,
    slug,
    browseAll,
    defaultSort,
    childToParent,
    parentSlugSet,
    topLevelCategories,
  } = input;
  const params =
    typeof searchKey === "string" ? new URLSearchParams(searchKey) : searchKey;

  const page = params.get("page") ? Number(params.get("page")) : 1;
  const search = params.get("search") || params.get("q") || undefined;
  // Same default as the sort dropdown. Departments used to start at lowest
  // price, which led every one of them with its cheapest parts — wastes and
  // robe hooks under Bathrooms, pipe bend and foil tape under Heating, blank
  // inserts under Electrical. An empty sort is the "Featured" order, which
  // leads with premium stock and then runs newest-first. A keyword search
  // still starts at newest so relevance is not buried.
  const sort = params.get("sort") ?? (search ? "newest" : defaultSort ?? "");
  const minPrice = params.get("minPrice");
  const maxPrice = params.get("maxPrice");
  const sizes = parseList(params.get("size"));
  const brands = parseList(params.get("brand"));
  const subBrands = parseList(params.get("subBrand"));
  const departments = parseList(params.get("department"));
  const colours = parseList(params.get("colour") || params.get("color"));
  const styles = parseList(params.get("style"));
  const ranges = parseList(params.get("range"));
  const onSale =
    params.get("onSale") === "1" ||
    params.get("onSale") === "true" ||
    params.get("sale") === "1";
  const categories = parseList(params.get("category") || params.get("finish"));
  const subcategory = params.get("subcategory")?.trim() || undefined;

  let parentForQuery: string | string[] | undefined =
    categories.length > 0
      ? categories
      : browseAll || slug === "all"
        ? undefined
        : slug;
  let subForQuery: string | undefined = subcategory;

  // A single `?category=` value can name a child menu, which the query wants
  // as `subCategory` under its parent instead. Only the menu tree can tell.
  const needsMenuRemap = categories.length === 1;

  if (
    !subForQuery &&
    categories.length === 1 &&
    childToParent &&
    !topLevelCategories?.has(categories[0])
  ) {
    const parent = childToParent.get(categories[0]);
    if (parent) {
      parentForQuery = parent;
      subForQuery = categories[0];
    }
  }

  if (
    subForQuery &&
    categories.length === 1 &&
    parentSlugSet?.has(categories[0])
  ) {
    parentForQuery = categories[0];
  }

  return {
    needsMenuRemap,
    query: {
      category: parentForQuery,
      subCategory: subForQuery,
      size: sizes.length ? sizes : undefined,
      brand: brands.length ? brands : undefined,
      subBrand: subBrands.length ? subBrands : undefined,
      department: departments.length ? departments : undefined,
      colour: colours.length ? colours : undefined,
      style: styles.length ? styles : undefined,
      range: ranges.length ? ranges : undefined,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      sort,
      search,
      page,
      limit: LISTING_PAGE_SIZE,
      onSale: onSale || undefined,
      // Hides listings with no photo at all, rather than showing a bare
      // placeholder icon. Query-level only — no product data touched.
      requireImages: true,
      fields: LISTING_FIELDS,
    },
  };
}

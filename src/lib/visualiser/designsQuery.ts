/**
 * The room visualiser's design list: what it may ask for, validated.
 *
 * Kept apart from the route so the allowed values are one list the page's
 * filter chips and the API both read.
 */

import { LISTING_PAGE_SIZE } from "@/lib/listingQuery";

/** Same page size as the Flooring department grid (36). */
export const DESIGNS_PAGE_SIZE = LISTING_PAGE_SIZE;
export const DESIGNS_MAX_PAGE = 500;
export const DESIGNS_MAX_SEARCH = 80;
/** Most saved (wishlisted) designs fetched at once. */
export const DESIGNS_MAX_IDS = 60;

/**
 * Filter chips: the Flooring mega-menu's "Shop by type" (src/lib/megaMenu.ts).
 * No Carpet chip: carpets are unpriced, so the storefront hides them anyway.
 */
export const DESIGN_TYPES = [
  { key: "all", label: "All flooring" },
  { key: "laminate", label: "Laminate", category: ["laminate", "laminate-flooring"] },
  { key: "lvt", label: "LVT", category: ["luxury-vinyl-tile", "lvt-flooring"] },
  { key: "vinyl", label: "Vinyl", category: ["vinyl", "vinyl-flooring"] },
  { key: "wood", label: "Wood", category: ["wood", "wood-flooring"] },
  { key: "engineered", label: "Engineered wood", category: ["engineered-wood-flooring"] },
  { key: "solid", label: "Solid wood", category: ["solid-wood-flooring"] },
  { key: "parquet", label: "Parquet", category: ["parquet-flooring"] },
  {
    key: "herringbone",
    label: "Herringbone",
    subCategory: [
      "herringbone-parquet-flooring",
      "herringbone-engineered-wood-flooring",
      "herringbone-flooring",
    ],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  category?: readonly string[];
  subCategory?: readonly string[];
}[];

export type DesignTypeKey = (typeof DESIGN_TYPES)[number]["key"];

/** Sort options, as the catalogue's own sort dropdown names them. */
export const DESIGN_SORTS = [
  { key: "", label: "Featured" },
  { key: "newest", label: "Newest" },
  { key: "price-asc", label: "Price: low to high" },
  { key: "price-desc", label: "Price: high to low" },
  { key: "name-asc", label: "Name: A–Z" },
] as const;

export type DesignSortKey = (typeof DESIGN_SORTS)[number]["key"];

export type DesignsQuery = {
  /** Only these products (the customer's saved list), when set. */
  ids?: string[];
  page: number;
  q: string;
  type: DesignTypeKey;
  sort: DesignSortKey;
};

/** Parse and clamp the query string; anything unknown falls back to a default. */
export function parseDesignsQuery(params: URLSearchParams): DesignsQuery {
  const rawPage = Number.parseInt(params.get("page") || "1", 10);
  const page = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), DESIGNS_MAX_PAGE) : 1;

  const q = String(params.get("q") || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DESIGNS_MAX_SEARCH);

  const rawType = String(params.get("type") || "all");
  const type = (DESIGN_TYPES.some((t) => t.key === rawType) ? rawType : "all") as DesignTypeKey;

  const rawSort = String(params.get("sort") ?? "");
  const sort = (DESIGN_SORTS.some((s) => s.key === rawSort) ? rawSort : "") as DesignSortKey;

  const ids = String(params.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-f0-9]{24}$/i.test(s));
  const uniqueIds = [...new Set(ids)].slice(0, DESIGNS_MAX_IDS);

  return { page, q, type, sort, ...(params.has("ids") ? { ids: uniqueIds } : {}) };
}

/**
 * The room visualiser's design list: what it may ask for, validated.
 *
 * Kept apart from the route so the allowed values are one list the page's
 * filter dropdown and the API both read.
 *
 * The list shows one kind at a time, never mixed: all flooring or all tiles.
 * The floor takes either (the customer picks); a wall takes tiles only.
 */

import { LISTING_PAGE_SIZE } from "@/lib/listingQuery";
import type { SurfaceKind } from "@/lib/visualiser/flooring";

/** Per page: the Flooring/Tiles department grid size (36). */
export const DESIGNS_PAGE_SIZE = LISTING_PAGE_SIZE;
export const DESIGNS_MAX_PAGE = 500;
export const DESIGNS_MAX_SEARCH = 80;
/** Most saved (wishlisted) designs fetched at once. */
export const DESIGNS_MAX_IDS = 60;

export const DESIGN_SURFACES = ["floor", "wall"] as const satisfies readonly SurfaceKind[];

/** Which department a list reads; the same values as a design's `kind`. */
export type DesignSource = "flooring" | "tile";

/** The list's only filter: all flooring, or all tiles. */
export const DESIGN_TYPES = [
  { key: "all-flooring", label: "All flooring", source: "flooring" },
  { key: "all-tiles", label: "All tiles", source: "tile" },
] as const satisfies readonly { key: string; label: string; source: DesignSource }[];

export type DesignTypeKey = (typeof DESIGN_TYPES)[number]["key"];
export type DesignType = (typeof DESIGN_TYPES)[number];

/** The options offered on a surface: a wall never offers flooring. */
export function designTypesFor(surface: SurfaceKind): DesignType[] {
  return DESIGN_TYPES.filter((t) => surface !== "wall" || t.source === "tile");
}

/** The option that lists one source. */
export function designTypeFor(source: DesignSource): DesignTypeKey {
  return source === "tile" ? "all-tiles" : "all-flooring";
}

/** The source an option lists. */
export function sourceOfType(type: DesignTypeKey): DesignSource {
  return type === "all-tiles" ? "tile" : "flooring";
}

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
  /** The surface being designed; a wall takes tiles only. */
  surface: SurfaceKind;
  /** Only these products (the customer's saved list), when set. */
  ids?: string[];
  page: number;
  q: string;
  /** All flooring or all tiles — always one valid for the surface. */
  type: DesignTypeKey;
  sort: DesignSortKey;
};

/** Parse and clamp the query string; anything unknown falls back to a default. */
export function parseDesignsQuery(params: URLSearchParams): DesignsQuery {
  const rawSurface = String(params.get("surface") || "floor");
  const surface: SurfaceKind = (DESIGN_SURFACES as readonly string[]).includes(rawSurface)
    ? (rawSurface as SurfaceKind)
    : "floor";

  const rawPage = Number.parseInt(params.get("page") || "1", 10);
  const page = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), DESIGNS_MAX_PAGE) : 1;

  const q = String(params.get("q") || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DESIGNS_MAX_SEARCH);

  // Missing, unknown, or flooring asked for a wall: the surface's default —
  // flooring for the floor, tiles for a wall.
  const rawType = String(params.get("type") || "");
  const offered = designTypesFor(surface);
  const type = offered.find((t) => t.key === rawType)?.key ?? offered[0].key;

  const rawSort = String(params.get("sort") ?? "");
  const sort = (DESIGN_SORTS.some((s) => s.key === rawSort) ? rawSort : "") as DesignSortKey;

  const ids = String(params.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-f0-9]{24}$/i.test(s));
  const uniqueIds = [...new Set(ids)].slice(0, DESIGNS_MAX_IDS);

  return { surface, page, q, type, sort, ...(params.has("ids") ? { ids: uniqueIds } : {}) };
}

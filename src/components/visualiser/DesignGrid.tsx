"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Check, Heart, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { productHref } from "@/lib/productSlug";
import { ProductCard } from "@/components/products/ProductCard";
import { CollectionLoadMore } from "@/components/category/CollectionLoadMore";
import { useVisualiser } from "@/components/visualiser/VisualiserContext";
import { selectActiveSurface, selectCurrentDesign, selectListSurface } from "@/store/useVisualiserStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import {
  DESIGN_SORTS,
  DESIGNS_MAX_IDS,
  DESIGNS_MAX_SEARCH,
  designTypeFor,
  designTypesFor,
  sourceOfType,
  type DesignSortKey,
  type DesignTypeKey,
} from "@/lib/visualiser/designsQuery";
import type { SurfaceKind } from "@/lib/visualiser/flooring";
import type { VisualiserDesignCard, VisualiserDesignsResponse } from "@/lib/visualiser/types";

/**
 * `surface`: what the list is for — the floor or a wall. `type`: all flooring
 * or all tiles, never mixed (a wall: tiles only). `saved`: only the
 * customer's wishlisted designs of that type (with ids).
 */
type Filters = { surface: SurfaceKind; q: string; type: DesignTypeKey; sort: DesignSortKey; saved: boolean; ids: string };

const EMPTY: VisualiserDesignsResponse = { designs: [], page: 1, total: 0, totalPages: 0 };

/**
 * Pages already fetched this visit, so going back to a filter (or a chip the
 * customer already tried) shows at once — the same 3 minutes the site's own
 * router cache holds a catalogue page for (next.config staleTimes.dynamic).
 */
const PAGE_CACHE_MS = 180_000;
const filtersKey = (f: Filters) =>
  JSON.stringify(
    f.saved
      ? { surface: f.surface, type: f.type, saved: f.ids }
      : { surface: f.surface, q: f.q, type: f.type, sort: f.sort },
  );

/**
 * The designs the visualiser can lay on the surface being edited, as the
 * Flooring and Tiles departments list them: ProductCard (name, price, Add to
 * cart, wishlist) and "Load more". One kind at a time: the floor opens on
 * what the customer came from (flooring or tiles) and they may switch; a wall
 * shows tiles only. Clicking a card's photo or name lays it on the surface
 * instead of leaving the page; "Details" opens the product.
 */
export function DesignGrid({ initial }: { initial: VisualiserDesignsResponse }) {
  const current = useVisualiser(selectCurrentDesign);
  const applyDesign = useVisualiser((s) => s.applyDesign);
  const surface = useVisualiser(selectListSurface);
  const activeSurface = useVisualiser(selectActiveSurface);
  const entry = useVisualiser((s) => s.entry);
  const types = useMemo(() => designTypesFor(surface), [surface]);

  /** Lay a design; the store refuses one the surface may not take, and says why. */
  const lay = useCallback(
    (item: VisualiserDesignCard) => {
      const result = applyDesign(item);
      if (!result.ok) toast.error(result.reason);
    },
    [applyDesign],
  );

  // Saved designs come from the shop's own wishlist (kept in the browser).
  const wishlist = useWishlistStore((s) => s.items);
  const savedIds = useMemo(
    () => wishlist.map((i) => i.id).filter((id) => /^[a-f0-9]{24}$/i.test(id)).slice(-DESIGNS_MAX_IDS).join(","),
    [wishlist],
  );

  // The server rendered page 1 of the floor's list for what the customer came
  // from (src/app/visualiser/page.tsx), so the grid starts on exactly that.
  const [startFilters] = useState<Filters>(() => ({
    surface: "floor",
    q: "",
    type: designTypeFor(entry),
    sort: "",
    saved: false,
    ids: "",
  }));
  // The floor's own choice, kept while a wall (tiles only) is being designed.
  const floorType = useRef<DesignTypeKey>(startFilters.type);
  const [filters, setFilters] = useState<Filters>(startFilters);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<VisualiserDesignsResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  // The filters the grid currently shows; the server rendered the defaults.
  const shownKey = useRef(filtersKey(startFilters));
  const retryCount = useRef(0);

  const pageCache = useRef(
    new Map<string, { at: number; data: VisualiserDesignsResponse }>([
      [`${filtersKey(startFilters)}#1`, { at: Date.now(), data: initial }],
    ]),
  );

  const fetchPage = useCallback(async (f: Filters, page: number, signal: AbortSignal) => {
    if (f.saved && !f.ids) return EMPTY;
    const cacheKey = `${filtersKey(f)}#${page}`;
    const hit = pageCache.current.get(cacheKey);
    if (hit && Date.now() - hit.at < PAGE_CACHE_MS) return hit.data;
    const params = f.saved
      ? new URLSearchParams({ surface: f.surface, type: f.type, ids: f.ids })
      : new URLSearchParams({ surface: f.surface, page: String(page), type: f.type, sort: f.sort });
    if (f.q && !f.saved) params.set("q", f.q);
    const res = await fetch(`/api/visualiser/designs?${params}`, { signal });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !Array.isArray(json.designs)) {
      throw new Error(json?.error || "Could not load designs.");
    }
    const data = json as VisualiserDesignsResponse;
    pageCache.current.set(cacheKey, { at: Date.now(), data });
    return data;
  }, []);

  // Debounce typing into the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = search.trim().slice(0, DESIGNS_MAX_SEARCH);
      setFilters((f) => (f.q === q ? f : { ...f, q }));
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Follow the surface being edited: a wall lists tiles only; back on the
  // floor, the list is again whichever of flooring or tiles it was showing.
  useEffect(() => {
    setFilters((f) =>
      f.surface === surface
        ? f
        : { ...f, surface, type: surface === "wall" ? designTypeFor("tile") : floorType.current },
    );
  }, [surface]);

  const chooseType = (value: string) => {
    const type = types.find((t) => t.key === value)?.key;
    if (!type) return; // not offered on this surface (flooring on a wall)
    if (surface === "floor") floorType.current = type;
    setFilters((f) => (f.type === type ? f : { ...f, type }));
  };

  // Keep the saved view in step with the wishlist (hearting a card adds to it).
  useEffect(() => {
    setFilters((f) => (f.saved && f.ids !== savedIds ? { ...f, ids: savedIds } : f));
  }, [savedIds]);

  // New filters: start again from page 1 (the server sent the unfiltered page 1).
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const key = filtersKey(filters);
    // Already showing these filters (first render, or React re-running the
    // effect in development) and not an explicit retry: nothing to fetch.
    if (key === shownKey.current && retry === retryCount.current) return;
    retryCount.current = retry;
    shownKey.current = key;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    fetchPage(filters, 1, controller.signal)
      .then((res) => setData(res))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load designs.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, retry, fetchPage]);

  const loadMore = async () => {
    if (loadingMore || loading || data.page >= data.totalPages) return;
    const controller = new AbortController();
    requestRef.current = controller;
    // The list this page belongs to. If the filters or the surface change
    // while it loads (tapping a wall switches to tiles), it must not be
    // appended to the new list — a cached page resolves even after an abort.
    const key = filtersKey(filters);
    setLoadingMore(true);
    try {
      const next = await fetchPage(filters, data.page + 1, controller.signal);
      if (controller.signal.aborted || shownKey.current !== key) return;
      setData((prev) => {
        const seen = new Set(prev.designs.map((d) => d.card.id));
        return {
          ...next,
          designs: [...prev.designs, ...next.designs.filter((d) => !seen.has(d.card.id))],
        };
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load more designs.");
    } finally {
      setLoadingMore(false);
    }
  };

  /** Clicks on a card's photo or name lay the design instead of navigating. */
  const interceptCardLink = (e: MouseEvent<HTMLDivElement>, item: VisualiserDesignCard) => {
    const link = (e.target as HTMLElement).closest("a");
    if (link && link.closest("article") && e.currentTarget.contains(link)) {
      e.preventDefault();
      e.stopPropagation();
      lay(item);
    }
  };

  const listingTiles = sourceOfType(filters.type) === "tile";
  const kindName = listingTiles ? "tiles" : "flooring";
  const surfaceName = activeSurface?.label ?? (surface === "wall" ? "this wall" : "the floor");

  // Saved view: the search box narrows the saved list by name, in the browser.
  const shown = useMemo(() => {
    if (!filters.saved || !filters.q) return data.designs;
    const q = filters.q.toLowerCase();
    return data.designs.filter((d) => d.card.name.toLowerCase().includes(q));
  }, [data.designs, filters.saved, filters.q]);

  const countText = loading
    ? "Loading…"
    : (() => {
        const n = filters.saved ? shown.length : data.total;
        return `${n.toLocaleString("en-GB")} ${filters.saved ? "saved " : ""}${n === 1 ? "design" : "designs"}`;
      })();

  // Laid out like the testing-app products panel: search, sort + saved count,
  // type chips, then the design grid — sized for the side panel.
  return (
    <section aria-label={`Choose a design for ${surfaceName}`} className="min-w-0 space-y-3">
      <p className="text-[11px] text-black/60">
        {surface === "wall" ? (
          <>Tiles for <strong className="capitalize text-black">{surfaceName}</strong> — flooring can only go on the floor.</>
        ) : (
          <>
            {listingTiles ? "Tiles" : "Flooring"} for <strong className="capitalize text-black">{surfaceName}</strong> — switch
            to {listingTiles ? "all flooring" : "all tiles"} below.
          </>
        )}
      </p>
      <label className="relative block">
        <span className="sr-only">Search {kindName}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
        <input
          type="search"
          value={search}
          maxLength={DESIGNS_MAX_SEARCH}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${kindName}…`}
          className="h-10 w-full rounded-md border border-black/15 bg-white pl-9 pr-9 text-sm outline-none transition-colors focus:border-black"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-black/50 hover:text-black"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </label>

      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Sort</span>
          <select
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as DesignSortKey }))}
            disabled={filters.saved}
            className="h-10 w-full rounded-md border border-black/15 bg-white px-3 text-sm outline-none transition-colors focus:border-black disabled:opacity-50"
          >
            {DESIGN_SORTS.map((s) => (
              <option key={s.key || "featured"} value={s.key}>
                Sort: {s.label.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={filters.saved}
          aria-label={`Saved designs (${savedIds ? savedIds.split(",").length : 0})`}
          title="Show only saved designs"
          onClick={() => setFilters((f) => ({ ...f, saved: !f.saved, ids: savedIds }))}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
            filters.saved ? "border-black bg-black text-white" : "border-black/15 bg-white text-black hover:border-black",
          )}
        >
          <Heart className={cn("h-3.5 w-3.5", filters.saved && "fill-white")} />
          {savedIds ? savedIds.split(",").length : 0}
        </button>
      </div>

      <label className="block">
        <span className="sr-only">Flooring or tiles</span>
        {/* A wall takes tiles only, so there is nothing to choose there. */}
        <select
          value={filters.type}
          onChange={(e) => chooseType(e.target.value)}
          disabled={types.length < 2}
          title={types.length < 2 ? "Walls take tiles only" : undefined}
          className="h-10 w-full rounded-md border border-black/15 bg-white px-3 text-sm outline-none transition-colors focus:border-black disabled:opacity-60"
        >
          {types.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <p className="text-[11px] text-black/50" aria-live="polite">{countText}</p>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md bg-[#D3102F]/10 px-3 py-2.5 text-xs text-[#D3102F]">
          <span>{error}</span>
          <button type="button" className="font-semibold underline" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      <div className={cn("transition-opacity", loading && "pointer-events-none opacity-50")}>
        {!loading && shown.length === 0 && !error ? (
          <p className="py-10 text-center text-sm text-black/60">
            {filters.saved && !filters.ids
              ? "You haven't saved any designs yet. Tap the heart on a design to save it."
              : filters.saved
                ? `None of your saved designs are ${kindName}${filters.q ? ` matching “${filters.q}”` : ""}.`
                : `No ${kindName} designs match${filters.q ? ` “${filters.q}”` : ""}.`}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-4 min-[600px]:grid-cols-3 min-[900px]:grid-cols-2">
            {shown.map((item, index) => {
              const active = item.design.id === current?.design.id;
              return (
                <div
                  key={item.card.id}
                  onClickCapture={(e) => interceptCardLink(e, item)}
                  className={cn(
                    "relative min-w-0 rounded-md border bg-white p-1.5 transition-colors",
                    active ? "border-black" : "border-black/10 hover:border-black/30",
                  )}
                >
                  <ProductCard {...item.card} layout="minimal" renderWidth={200} imagePriority={index < 4} />
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => lay(item)}
                      aria-pressed={active}
                      className={cn(
                        "inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-sm text-[10px] font-semibold uppercase tracking-[0.4px] transition-colors",
                        active ? "bg-black text-white" : "border border-black/20 text-black hover:border-black",
                      )}
                    >
                      {active ? (
                        <>
                          <Check className="h-3 w-3 shrink-0" />{" "}
                          <span className="truncate">{surface === "wall" ? "On wall" : "On floor"}</span>
                        </>
                      ) : (
                        <span className="truncate">{surface === "wall" ? "Try on wall" : "Try on floor"}</span>
                      )}
                    </button>
                    <Link
                      href={productHref(item.card)}
                      className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.4px] text-black/60 underline underline-offset-2 hover:text-black"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!filters.saved ? (
        <CollectionLoadMore
          shown={data.designs.length}
          total={data.total}
          hasMore={data.page < data.totalPages}
          loading={loadingMore}
          onLoadMore={loadMore}
        />
      ) : null}
    </section>
  );
}

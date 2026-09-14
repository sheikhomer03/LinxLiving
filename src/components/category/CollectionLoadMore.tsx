"use client";

import { Loader2 } from "lucide-react";

/**
 * What a Lusso collection page puts under its grid in place of page numbers.
 *
 * Measured on /collections/heating at 1440: one "Load More" that appends the
 * next 36 products beneath the ones already on screen, with the result count
 * and a progress bar above it. The numbered pagination is in that page's
 * markup too, but carries `hidden` — it exists for crawlers, not shoppers.
 *
 * The three parts are written here in the order they appear; the reference
 * gets the same order out of a `column` flexbox with `order: 1/2/3`.
 *
 *   wrapper  flex column, 448px wide, centred, 40px above (16px on mobile)
 *   count    14px, centred
 *   bar      320px wide, 20%-black track with a black fill
 *   button   12px/500 white on black, 12px 24px padding, fit-content
 */
export function CollectionLoadMore({
  shown,
  total,
  hasMore,
  loading,
  onLoadMore,
}: {
  /** Products currently in the grid, across every page loaded so far. */
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  if (!total) return null;

  const progress = total > 0 ? Math.min(100, (shown / total) * 100) : 0;

  return (
    <div className="mx-auto mt-4 flex max-w-[448px] flex-col min-[990px]:mt-10">
      <p className="text-center text-[14px] text-foreground">
        Showing {shown} of {total}
      </p>

      {/* Only drawn while there is something left to load — a full bar under
          a page with no button reads as a stalled loader. */}
      {hasMore ? (
        <div className="mx-auto mt-4 mb-6 h-0.5 w-full max-w-[320px] bg-black/20">
          <div
            className="h-full bg-black transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="mx-auto flex w-fit items-center justify-center gap-2 bg-black px-6 py-3 text-[12px] font-medium leading-[1.2] text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Load More
        </button>
      ) : null}
    </div>
  );
}

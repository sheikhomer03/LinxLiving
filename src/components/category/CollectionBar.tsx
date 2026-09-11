"use client";

import Link from "next/link";
import { ChevronRight, LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The sticky row between a Lusso collection's hero and its grid.
 *
 * Three zones on one line: breadcrumb left, the collection's sibling
 * categories as chips in the middle, and View / Filter right. It sticks
 * directly beneath the header — `top` is the same
 * `--lx-announce-h + --lx-header-h` the rest of the storefront measures
 * from — and carries no result count or sort control, both of which live in
 * the filter drawer on that site.
 *
 *   bar     sticky, white, 16px top / 32px bottom padding
 *   crumb   14px, black, sentence case
 *   chip    12px uppercase, tracking 1.2px, 1px border, square corners
 *   actions 14px
 */

export type CollectionChip = {
  label: string;
  href: string;
  active?: boolean;
};

export function CollectionBar({
  breadcrumb,
  chips,
  viewMode,
  onViewModeChange,
  onOpenFilters,
  activeFilterCount = 0,
}: {
  breadcrumb: { label: string; href?: string }[];
  chips: CollectionChip[];
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  onOpenFilters: () => void;
  /** Shown beside "Filter" so a filtered grid never looks unfiltered. */
  activeFilterCount?: number;
}) {
  return (
    <div
      className="sticky z-30 bg-white pb-8 pt-4"
      style={{ top: "calc(var(--lx-announce-h) + var(--lx-header-h))" }}
    >
      <div className="flex flex-col gap-4 px-4 lg:flex-row lg:items-center lg:gap-6 lg:px-8">
        {breadcrumb.length > 0 ? (
          <nav
            aria-label="Breadcrumb"
            className="flex shrink-0 items-center gap-2 py-4 text-[12px] capitalize leading-[17px] tracking-[0.6px] text-black"
          >
            {breadcrumb.map((crumb, i) => (
              <span key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
                {i > 0 ? (
                  <ChevronRight className="h-3 w-3 shrink-0 text-black/40" />
                ) : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}

        {/* Chips take the middle and scroll rather than wrap — the reference
            keeps this row one line tall at every width. Masked on the right
            so a row longer than the space reads as scrollable rather than
            looking like a chip cut in half. */}
        {chips.length > 0 ? (
          <div className="min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/*
              `w-max mx-auto`, not `justify-center`: centring an overflowing
              flex row pushes its content off *both* edges, so the first
              chips became unreachable — the row opened mid-word. This
              centres the row while it fits and left-aligns it, scrollable,
              once it does not.
            */}
            <ul className="mx-auto flex w-max items-center gap-3 py-3 pr-8 min-[990px]:gap-6">
              {chips.map((chip) => (
                <li key={chip.href} className="shrink-0">
                  <Link
                    href={chip.href}
                    className={cn(
                      "font-menu inline-flex h-5 items-center whitespace-nowrap border px-2.5 text-[10px] font-medium uppercase leading-[14px] tracking-[1px] transition-colors",
                      chip.active
                        ? "border-black bg-black text-white"
                        : "border-black/10 bg-[#f5f5f5] text-black hover:border-black/40",
                    )}
                  >
                    {chip.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex shrink-0 items-center gap-5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onViewModeChange(viewMode === "grid" ? "list" : "grid")}
              aria-label={
                viewMode === "grid" ? "Switch to list view" : "Switch to grid view"
              }
              className="font-menu flex items-center gap-2 text-[12px] font-medium leading-[17px] tracking-[0.6px] text-black"
            >
              {viewMode === "grid" ? (
                <LayoutGrid className="h-4 w-4 opacity-100" />
              ) : (
                <List className="h-4 w-4 opacity-100" />
              )}
              View
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenFilters}
            className="font-menu flex items-center gap-2 text-[12px] font-medium leading-[17px] tracking-[0.6px] text-black"
          >
            <SlidersHorizontal className="h-4 w-4 opacity-100" />
            Filter
            {activeFilterCount > 0 ? (
              <span className="font-menu ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-black px-1 text-[9px] font-bold text-white">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export type CatalogueTile = {
  name: string;
  slug: string;
  image?: string;
  count: number;
  parentSlug?: string;
  parentName?: string;
  brandSlug?: string;
};

/** @deprecated Use CatalogueTile */
export type SubcategoryTile = CatalogueTile;

interface ShopByTilesProps {
  items: CatalogueTile[];
  activeSlug?: string | null;
  onSelect: (slug: string | null) => void;
  title?: string;
  clearLabel?: string;
  className?: string;
  /** When false, clicking active tile does not clear (keep a category selected) */
  allowClear?: boolean;
}

/**
 * Cambridge / Linx Glass type-tile grid — used for Shop by Category & Subcategory.
 */
export function ShopByTiles({
  items,
  activeSlug,
  onSelect,
  title = "Shop by Subcategory",
  clearLabel = "Clear ×",
  className,
  allowClear = true,
}: ShopByTilesProps) {
  if (!items.length) return null;

  return (
    <section
      className={cn(
        "mb-8 md:mb-10 pb-8 md:pb-10 border-b border-foreground/10",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-lg md:text-xl font-serif tracking-wide text-foreground">
          {title}
        </h2>
        {allowClear && activeSlug ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            {clearLabel}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item) => {
          const active = activeSlug === item.slug;
          return (
            <button
              key={`${item.brandSlug || ""}-${item.parentSlug || ""}-${item.slug}`}
              type="button"
              onClick={() => {
                if (active && allowClear) onSelect(null);
                else if (!active) onSelect(item.slug);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border bg-white px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-foreground ring-1 ring-foreground/20"
                  : "border-foreground/12 hover:border-foreground/40",
              )}
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded border border-foreground/10 bg-secondary">
                {item.image ? (
                  <Image
                    src={item.image}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-secondary" />
                )}
              </div>
              <span className="min-w-0 flex-1 text-sm font-medium text-foreground leading-snug">
                {item.name}{" "}
                <span className="font-normal text-foreground/50">
                  ({item.count.toLocaleString("en-GB")})
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Back-compat alias */
export const ShopBySubcategory = ShopByTiles;

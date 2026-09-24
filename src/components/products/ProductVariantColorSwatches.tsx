"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { VariantColorOption } from "@/lib/variantSiblings";

type Props = {
  options: VariantColorOption[];
  className?: string;
};

/**
 * Colour swatches for brands where each colourway is a genuinely separate
 * product (Walls and Floors) — unlike ProductColorSwatches (same-document
 * Noken-style variants, swaps a local image), clicking one here navigates
 * to that colourway's own product page, since price/stock/SKU can differ.
 *
 * Each swatch shows that colourway's own photo, not a flat colour chip —
 * closest to what the swatch actually looks like before committing to it.
 * Responsive down to 300px: swatches wrap and shrink rather than
 * overflowing or forcing horizontal scroll.
 */
export function ProductVariantColorSwatches({ options, className }: Props) {
  const router = useRouter();
  if (!options.length) return null;
  const current = options.find((o) => o.isCurrent);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-2 min-h-[1.25rem]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/55">
          Colour
        </p>
        {current ? (
          <p className="text-xs text-foreground/70 truncate">{current.name}</p>
        ) : null}
      </div>
      <div
        className="flex flex-wrap gap-2"
        role="listbox"
        aria-label="Colours"
      >
        {options.map((option) => {
          const selected = option.isCurrent;
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={selected}
              title={option.name}
              disabled={selected}
              onClick={() => {
                if (selected) return;
                router.push(`/products/${option.id}`);
              }}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                "h-11 w-11 min-[360px]:h-12 min-[360px]:w-12",
                selected
                  ? "border-foreground cursor-default"
                  : "border-foreground/15 hover:border-foreground/45 cursor-pointer",
              )}
            >
              {option.image ? (
                <Image
                  src={option.image}
                  alt={option.name}
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-[#faf8f3] text-[9px] font-medium text-foreground/50">
                  {option.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="sr-only">{option.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

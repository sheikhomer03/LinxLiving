"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import type { ProductSizeEntry } from "@/lib/productSizes";

type Props = {
  sizes: ProductSizeEntry[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  className?: string;
};

/**
 * Selectable size options (name + optional image).
 */
export function ProductSizeSwatches({
  sizes,
  selectedIndex,
  onSelect,
  className,
}: Props) {
  const list = (sizes || []).filter((s) => String(s?.name || "").trim());
  if (!list.length) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/55">
          Size
        </p>
        {selectedIndex != null && list[selectedIndex] ? (
          <p className="text-xs text-foreground/70 truncate">
            {list[selectedIndex].name}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2" role="listbox" aria-label="Sizes">
        {list.map((size, index) => {
          const selected = selectedIndex === index;
          const img = String(size.imageUrl || "").trim();
          return (
            <button
              key={`${size.name}-${index}`}
              type="button"
              role="option"
              aria-selected={selected}
              title={size.name}
              onClick={() => onSelect(index)}
              className={cn(
                "min-w-[5.5rem] max-w-[9rem] rounded-lg border px-2.5 py-2 text-left transition-colors",
                selected
                  ? "border-foreground bg-foreground text-white"
                  : "border-foreground/15 bg-[#faf8f3] text-foreground hover:border-foreground/40",
              )}
            >
              {img ? (
                <span className="relative mb-1.5 block h-12 w-full overflow-hidden rounded-md bg-white/80">
                  <Image
                    src={img}
                    alt=""
                    fill
                    className="object-contain"
                    sizes="96px"
                    unoptimized
                  />
                </span>
              ) : null}
              <span className="block text-xs font-semibold leading-snug break-words">
                {size.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

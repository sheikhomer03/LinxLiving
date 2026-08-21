"use client";

import { cn } from "@/lib/utils";
import type { ProductSizeEntry } from "@/lib/productSizes";

type Props = {
  sizes: ProductSizeEntry[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  className?: string;
};

/**
 * Selectable size options, as a dropdown.
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
      <p className="text-[11px] font-semibold uppercase tracking-widest text-foreground/55">
        Size
      </p>
      <select
        value={selectedIndex ?? ""}
        onChange={(e) => onSelect(Number(e.target.value))}
        aria-label="Size"
        className="w-full rounded-lg border border-foreground/15 bg-[#faf8f3] px-3.5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-foreground/40 focus:outline-none focus:border-foreground"
      >
        {list.map((size, index) => (
          <option key={`${size.name}-${index}`} value={index}>
            {size.name}
          </option>
        ))}
      </select>
    </div>
  );
}

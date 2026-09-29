"use client";

import { cn } from "@/lib/utils";
import type { ProductSizeEntry } from "@/lib/productSizes";
import { VariantSelect } from "@/components/ui/VariantSelect";

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
      <VariantSelect
        value={selectedIndex == null ? "" : String(selectedIndex)}
        onChange={(value) => onSelect(Number(value))}
        ariaLabel="Size"
        placeholder="Select a size"
        options={list.map((size, index) => ({
          value: String(index),
          label: String(size.name),
        }))}
      />
    </div>
  );
}

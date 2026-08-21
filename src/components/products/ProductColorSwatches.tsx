"use client";

import { cn } from "@/lib/utils";
import {
  colorSwatchStyle,
  type ProductColorOption,
} from "@/lib/productColors";

type Props = {
  colors: ProductColorOption[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  className?: string;
  size?: "sm" | "md";
};

/**
 * Selectable colour swatches (Noken-style). Choosing a colour swaps the
 * associated product image via the parent.
 */
export function ProductColorSwatches({
  colors,
  selectedIndex,
  onSelect,
  className,
  size = "md",
}: Props) {
  const list = (colors || []).filter((c) => String(c?.name || "").trim());
  if (!list.length) return null;

  const dim = size === "sm" ? "w-7 h-7" : "w-9 h-9";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/55">
          Colour
        </p>
        {selectedIndex != null && list[selectedIndex] ? (
          <p className="text-xs text-foreground/70 truncate">
            {list[selectedIndex].name}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2" role="listbox" aria-label="Colours">
        {list.map((color, index) => {
          const selected = selectedIndex === index;
          return (
            <button
              key={`${color.name}-${color.sap || index}`}
              type="button"
              role="option"
              aria-selected={selected}
              title={color.name}
              onClick={() => onSelect(index)}
              className={cn(
                "rounded-full border-2 p-0.5 transition-all",
                selected
                  ? "border-foreground scale-105"
                  : "border-transparent hover:border-foreground/30",
              )}
            >
              <span
                className={cn(
                  "block rounded-full border border-foreground/15 shadow-inner",
                  dim,
                )}
                style={colorSwatchStyle(color)}
              />
              <span className="sr-only">{color.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";

export type CatalogVariant = {
  name?: string;
  sku?: string;
  option1?: string;
  option2?: string;
  option3?: string;
  price?: number;
  compareAtPrice?: number | null;
  available?: boolean;
  imageUrl?: string;
  /**
   * This variant's own Shopify variant GID. Absent means it has not been
   * synced, and it cannot be sold through Shopify checkout — the cart would
   * otherwise fall back to the product-level variant and charge its price.
   */
  shopifyVariantId?: string | null;
};

export type VariantAxis = {
  name: string;
  position?: number;
  values?: string[];
};

/** Value of the axis at `position` on a variant row. */
export function variantOptionAt(v: CatalogVariant, position: number) {
  return String(
    (position === 1 ? v.option1 : position === 2 ? v.option2 : v.option3) || "",
  ).trim();
}

/**
 * Supplier option picker for catalogues that sell one product with several
 * option axes (e.g. a light switch's Type). Values the supplier can't ship are
 * shown but labelled, exactly as their PDP does.
 */
export function ProductVariantPicker({
  axes,
  variants,
  selection,
  onSelect,
  className,
}: {
  axes: VariantAxis[];
  variants: CatalogVariant[];
  selection: Record<string, string>;
  onSelect: (axisName: string, value: string) => void;
  className?: string;
}) {
  const usable = (axes || []).filter((a) => a.name && (a.values || []).length > 1);
  if (!usable.length || (variants || []).length < 2) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {usable.map((axis, i) => {
        const position = Number(axis.position) || i + 1;
        const values = axis.values || [];
        return (
          <div key={axis.name}>
            <label
              htmlFor={`option-${axis.name}`}
              className="mb-1.5 block text-sm font-semibold text-foreground"
            >
              {axis.name}:
            </label>
            <select
              id={`option-${axis.name}`}
              value={selection[axis.name] || values[0] || ""}
              onChange={(e) => onSelect(axis.name, e.target.value)}
              className="h-11 w-full rounded-lg border border-foreground/20 bg-white px-3 text-sm outline-none focus:border-foreground/60"
            >
              {values.map((value) => {
                const sellable = variants.some(
                  (v) =>
                    variantOptionAt(v, position).toLowerCase() ===
                      value.toLowerCase() && v.available !== false,
                );
                return (
                  <option key={value} value={value}>
                    {sellable ? value : `${value} - Unavailable`}
                  </option>
                );
              })}
            </select>
          </div>
        );
      })}
    </div>
  );
}

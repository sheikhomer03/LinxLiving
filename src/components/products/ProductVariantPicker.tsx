"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { cdnImageUrl } from "@/lib/productImage";

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
  /**
   * This variant's own photographs, mirrored onto the Shopify CDN.
   *
   * Drench and Tap Warehouse shoot each finish separately, so choosing one is
   * meant to change the gallery rather than only the hero tile. Stored as the
   * same `{sourceUrl, shopifyUrl}` pairing the product uses, because the
   * storefront renders Shopify URLs only.
   */
  shopifyImages?: { sourceUrl?: string; shopifyUrl?: string; position?: number }[];
  images?: string[];
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
  /*
   * A single-value axis is still shown.
   *
   * Suppliers publish them deliberately — Drench lists "Option: White
   * Worktop" beside a four-way Finish — and hiding it described the product
   * less completely than the source does.
   */
  const usable = (axes || []).filter((a) => a.name && (a.values || []).length > 0);
  if (!usable.length || (variants || []).length < 2) return null;

  /** The first mirrored photograph a value has, if any. */
  const pictureFor = (position: number, value: string) => {
    const hit = (variants || []).find(
      (v) =>
        variantOptionAt(v, position).toLowerCase() === value.toLowerCase() &&
        (v.shopifyImages || []).some((p) => p && p.shopifyUrl),
    );
    if (!hit) return "";
    const first = (hit.shopifyImages || [])
      .slice()
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
      .find((p) => p && p.shopifyUrl);
    return first ? String(first.shopifyUrl) : "";
  };

  return (
    <div className={cn("space-y-4", className)}>
      {usable.map((axis, i) => {
        const position = Number(axis.position) || i + 1;
        const values = axis.values || [];
        const selected = selection[axis.name] || values[0] || "";
        const pictures = values.map((v) => pictureFor(position, v));
        /*
         * Swatches only where the picture actually changes with the value.
         *
         * Every variant carries the product's gallery, so "does this value
         * have an image?" is true for all of them and dressed Size up as a
         * row of identical photographs. An axis earns swatches by looking
         * different — a finish does, a size does not — and the rest stay a
         * dropdown, which is what the supplier shows too.
         */
        const distinctPictures = new Set(pictures.filter(Boolean));
        /*
         * Only an appearance axis gets swatches.
         *
         * Pictures alone cannot decide it: a towel rail's three lengths each
         * photograph differently, so a one-to-one image test dressed Size up
         * as swatches. The supplier keys on the axis itself — finishes render
         * as `colour-swatch`, everything else as plain controls — so the name
         * is the honest signal, with the image test kept as a guard.
         */
        const isAppearanceAxis = /^(finish|colour|color|shade|texture)$/i.test(
          String(axis.name || "").trim(),
        );
        /*
         * One value, one distinct picture — anything less is not a swatch axis.
         *
         * "At least two differ" was not enough: three sizes whose variant
         * galleries happen to lead with two different photographs passed the
         * test and rendered as a row of near-identical images. A finish maps
         * one-to-one onto its picture; a size does not, so it stays a
         * dropdown, which is what the supplier shows for it too.
         */
        const hasPictures =
          isAppearanceAxis &&
          values.length > 1 &&
          pictures.every(Boolean) &&
          distinctPictures.size === values.length;
        const sellable = (value: string) =>
          variants.some(
            (v) =>
              variantOptionAt(v, position).toLowerCase() === value.toLowerCase() &&
              v.available !== false,
          );

        return (
          <div key={axis.name}>
            <label
              htmlFor={`option-${axis.name}`}
              className="mb-1.5 block text-sm font-semibold text-foreground"
            >
              {axis.name}:{" "}
              <span className="font-normal text-foreground/70">{selected}</span>
            </label>

            {hasPictures ? (
              /*
               * Photographed values are shown as swatches, the way the
               * supplier does and the way FAKRO's finishes already render
               * here — a list of words cannot convey a finish.
               */
              <div
                id={`option-${axis.name}`}
                role="radiogroup"
                aria-label={axis.name}
                className="flex flex-wrap gap-2"
              >
                {values.map((value, n) => {
                  const src = pictures[n];
                  const isOn = selected.toLowerCase() === value.toLowerCase();
                  const ok = sellable(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={isOn}
                      title={ok ? value : `${value} - Unavailable`}
                      onClick={() => onSelect(axis.name, value)}
                      className={cn(
                        "relative h-16 w-16 overflow-hidden rounded-md border bg-white transition",
                        isOn
                          ? "border-foreground ring-2 ring-foreground/70"
                          : "border-foreground/20 hover:border-foreground/50",
                        !ok && "opacity-45",
                      )}
                    >
                      {src ? (
                        <Image
                          src={cdnImageUrl(src, 64)}
                          alt={value}
                          fill
                          sizes="64px"
                          className="object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center px-1 text-[10px] leading-tight text-foreground/70">
                          {value}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <select
                id={`option-${axis.name}`}
                value={selected}
                onChange={(e) => onSelect(axis.name, e.target.value)}
                className="h-11 w-full rounded-lg border border-foreground/20 bg-white px-3 text-sm outline-none focus:border-foreground/60"
              >
                {values.map((value) => (
                  <option key={value} value={value}>
                    {sellable(value) ? value : `${value} - Unavailable`}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

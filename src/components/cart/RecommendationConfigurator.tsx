"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Package, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/store/useCartStore";
import { cn } from "@/lib/utils";

/**
 * Quantity dialog for cart recommendations.
 *
 * A tile or a floor cannot be added as "1" — it is sold by the square metre
 * and shipped in whole packs, so the Add button in the recommendation list
 * opens this instead of dropping a unit into the basket.
 *
 * It deliberately handles only the area case. Ranges with their own bespoke
 * configurator — Pooky base/shade, Otto, the Under Floor Heating room
 * measure, Spectra Larsen — need choices this dialog has no business
 * guessing at, so those get a link to the product page rather than a
 * half-built version of their picker.
 */

export type ConfigurableProduct = {
  _id: string;
  name: string;
  /** Price per m² when sold by area, otherwise the unit price. */
  unitPrice: number;
  perSqm: boolean;
  /** m² per pack. Orders round up to whole packs when present. */
  packCoverageM2?: number | null;
  image?: string;
  category?: string;
  stock?: number;
  shopifyVariantId?: string | null;
  /** True when the range needs its own picker on the product page. */
  needsProductPage?: boolean;
};

function money(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function RecommendationConfigurator({
  product,
  onClose,
  onNavigate,
}: {
  product: ConfigurableProduct;
  onClose: () => void;
  /** Called when a link inside navigates to the product page — lets the
   * caller close its own drawer (cart or wishlist) on the way out. */
  onNavigate?: () => void;
}) {
  const addItem = useCartStore((s) => s.addItem);
  const [areaInput, setAreaInput] = useState("1");
  const [wastage, setWastage] = useState(true);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const pack = Number(product.packCoverageM2);
  const hasPacks = Number.isFinite(pack) && pack > 0;

  const { packs, billedM2, total, requestedM2 } = useMemo(() => {
    const raw = Math.max(0, Number(areaInput) || 0);
    // The 10% allowance covers cuts and breakages — the same rule the
    // product-page calculators use.
    const requested = wastage ? raw * 1.1 : raw;
    const p = hasPacks && requested > 0 ? Math.ceil(requested / pack) : 0;
    // Unrounded for the arithmetic: rounding the area first loses pennies on
    // every pack and the total stops matching the pack price.
    const billed = hasPacks ? p * pack : requested;
    return {
      packs: p,
      billedM2: billed,
      requestedM2: requested,
      total: Math.round(billed * product.unitPrice * 100) / 100,
    };
  }, [areaInput, wastage, hasPacks, pack, product.unitPrice]);

  const handleAdd = () => {
    if (billedM2 <= 0) {
      toast.error("Enter the area you need");
      return;
    }
    // Same shape the product page uses for an area order: one configured
    // line carrying the whole total, not N units of a per-m² rate.
    const area = Math.round(billedM2 * 100) / 100;
    const summary =
      hasPacks && packs > 0
        ? `${packs} pack${packs === 1 ? "" : "s"} · ${area}m² covered`
        : `${area}m² @ ${money(product.unitPrice)}/m²`;
    const result = addItem({
      id: `${product._id}::${area}m2`,
      name: product.name,
      price: total,
      image: product.image || "",
      category: product.category || "",
      shopifyVariantId: product.shopifyVariantId || undefined,
      isConfigured: true,
      configurationSummary: summary,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      hasPacks && packs > 0
        ? `${packs} pack${packs === 1 ? "" : "s"} added to your cart`
        : `${area}m² added to your cart`,
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-140 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      <div className="relative w-full max-w-md bg-white shadow-2xl sm:rounded-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3 border-b border-foreground/10 p-5">
          <div className="relative h-16 w-14 shrink-0 overflow-hidden bg-secondary">
            {product.image ? (
              <Image
                src={product.image}
                alt={product.name}
                fill
                sizes="56px"
                className="object-cover"
              />
            ) : (
              <Package className="m-auto h-5 w-5 text-foreground/20" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold leading-snug">{product.name}</p>
            <p className="mt-1 text-[13px] font-semibold text-primary">
              {money(product.unitPrice)}
              {product.perSqm ? (
                <span className="text-[11px] align-top">/m²</span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-foreground/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {product.needsProductPage ? (
          <div className="space-y-4 p-5">
            <p className="text-[13px] leading-relaxed text-foreground/70">
              This range has options to choose before it can be added — size,
              finish and fitting details are set on the product page.
            </p>
            <Link
              href={`/products/${product._id}`}
              onClick={onNavigate}
              className="inline-flex w-full items-center justify-center gap-2 bg-foreground px-4 py-3 text-[12px] font-bold uppercase tracking-[0.14em] text-background"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Choose options
            </Link>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <div className="space-y-2">
              <label
                htmlFor="rec-area"
                className="block text-[12px] font-semibold"
              >
                Area required (m²)
              </label>
              <input
                id="rec-area"
                type="number"
                min="0"
                step="0.01"
                value={areaInput}
                onChange={(e) => setAreaInput(e.target.value)}
                className="w-full border border-foreground/15 px-4 py-3 text-[15px] outline-none focus:border-foreground/40"
              />
            </div>

            <label className="flex items-start gap-2.5 text-[13px] text-foreground/75">
              <input
                type="checkbox"
                checked={wastage}
                onChange={(e) => setWastage(e.target.checked)}
                className="mt-0.5"
              />
              Add 10% for cuts and breakages
            </label>

            <div className="space-y-1 border-t border-foreground/10 pt-4">
              {hasPacks && packs > 0 ? (
                <p className="text-[12px] text-foreground/60">
                  {packs} pack{packs === 1 ? "" : "s"} ·{" "}
                  {billedM2.toFixed(2)}m² supplied
                  {billedM2 > requestedM2
                    ? ` (covers ${requestedM2.toFixed(2)}m²)`
                    : ""}
                </p>
              ) : null}
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">Total</span>
                <span className="text-2xl font-bold tabular-nums">
                  {money(total)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAdd}
              disabled={billedM2 <= 0}
              className={cn(
                "w-full bg-foreground px-4 py-3.5 text-[12px] font-bold uppercase tracking-[0.14em] text-background",
                billedM2 <= 0 && "opacity-40",
              )}
            >
              Add to basket
            </button>

            <Link
              href={`/products/${product._id}`}
              onClick={onNavigate}
              className="block text-center text-[11px] font-bold uppercase tracking-[0.14em] underline underline-offset-4 text-foreground/60"
            >
              View full product details
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

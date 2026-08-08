"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildSampleRequestHref } from "@/lib/priceOnRequest";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function round2(n: number) {
  return Math.round(Math.max(0, n) * 100) / 100;
}

export type DirectFlooringOrder = {
  /** Covered m² after pack rounding (what the customer pays for). */
  orderAreaM2: number;
  total: number;
  packs: number;
  requestedM2: number;
};

/**
 * Direct Flooring Online–style pack calculator:
 * enter m² → ceil packs by pack coverage → covered m² + pack total price.
 */
export function DirectFlooringConfigurator({
  pricePerPack,
  packCoverageM2,
  pricePerM2,
  productId,
  productName,
  brandName,
  sku,
  category,
  categoryName,
  disabled = false,
  onQuantityChange,
  onAddToBasket,
}: {
  pricePerPack: number;
  packCoverageM2: number;
  pricePerM2: number;
  productId: string;
  productName: string;
  brandName?: string;
  sku?: string;
  category?: string;
  categoryName?: string;
  disabled?: boolean;
  onQuantityChange?: (next: DirectFlooringOrder) => void;
  onAddToBasket?: () => void;
}) {
  const coverage = Math.max(0, Number(packCoverageM2) || 0);
  const packPrice = Math.max(0, Number(pricePerPack) || 0);
  const unitM2 = Math.max(0, Number(pricePerM2) || 0);
  const [areaInput, setAreaInput] = useState("");

  const requestedM2 = useMemo(
    () => Math.max(0, Number(areaInput) || 0),
    [areaInput],
  );

  const packs = useMemo(() => {
    if (coverage <= 0 || requestedM2 <= 0) return 0;
    return Math.ceil(requestedM2 / coverage);
  }, [requestedM2, coverage]);

  const coveredM2 = useMemo(
    () => round2(packs * coverage),
    [packs, coverage],
  );

  const total = useMemo(
    () => Math.round(packs * packPrice * 100) / 100,
    [packs, packPrice],
  );

  const notify = useRef(onQuantityChange);
  notify.current = onQuantityChange;
  useEffect(() => {
    notify.current?.({
      orderAreaM2: coveredM2,
      total,
      packs,
      requestedM2: round2(requestedM2),
    });
  }, [coveredM2, total, packs, requestedM2]);

  const sampleHref = buildSampleRequestHref({
    id: productId,
    name: productName,
    brandName,
    sku,
    category,
    categoryName,
    price: unitM2 || packPrice,
  });

  return (
    <div
      className={cn(
        "rounded-none border border-[#1f4f8a]/30 bg-[#1f4f8a] text-white",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold">
          <p>
            <span className="font-bold">Price Per Pack: </span>
            {formatPrice(packPrice)}
          </p>
          <p>
            <span className="font-bold">Pack Coverage: </span>
            {coverage > 0 ? `${coverage} m2` : "—"}
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="dfo-required-m2"
            className="block text-sm font-semibold"
          >
            Please input your required m2{" "}
            <span className="text-red-300">*</span>
          </label>
          <input
            id="dfo-required-m2"
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            value={areaInput}
            disabled={disabled || coverage <= 0}
            onChange={(e) => setAreaInput(e.target.value)}
            className="w-full max-w-[14rem] border border-white/40 bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-white"
          />
          <p className="text-xs text-white/85">
            Remember to include 10% wastage
          </p>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-4 border-b border-white/25 pb-2">
            <dt className="font-semibold">Number of Packs required</dt>
            <dd className="font-bold tabular-nums">{packs || ""}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-b border-white/25 pb-2">
            <dt className="font-semibold">Square Metres Covered</dt>
            <dd className="font-bold tabular-nums">
              {packs > 0 ? coveredM2 : ""}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-b border-white/25 pb-2">
            <dt className="font-semibold">Price</dt>
            <dd className="font-bold tabular-nums">
              {packs > 0 ? formatPrice(total) : ""}
            </dd>
          </div>
        </dl>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            disabled={disabled || packs <= 0}
            className="h-11 inline-flex items-center justify-center gap-2 bg-black text-white text-xs font-bold uppercase tracking-wide hover:bg-black/90 disabled:opacity-40"
            onClick={() => onAddToBasket?.()}
          >
            <ShoppingBag className="w-4 h-4" />
            Add to Basket
          </button>
          <Link
            href={sampleHref}
            className="h-11 inline-flex items-center justify-center gap-2 border-2 border-white bg-white text-[#1f4f8a] text-xs font-bold uppercase tracking-wide hover:bg-white/95"
          >
            Order Free Sample
          </Link>
        </div>
      </div>
    </div>
  );
}

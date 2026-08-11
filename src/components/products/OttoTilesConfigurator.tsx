"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ChevronUp, Info, Mail, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildContactEnquiryHref,
  buildSampleRequestHref,
} from "@/lib/priceOnRequest";
import {
  computeOttoOrder,
  round2,
} from "@/lib/ottoTilesCalculator";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type OttoOrder = {
  orderAreaM2: number;
  total: number;
  packs: number;
  requestedM2: number;
  isSample?: boolean;
};

const OVERAGE_OPTIONS = [
  { value: 0, label: "No Overage" },
  { value: 10, label: "+10%" },
  { value: 15, label: "+15%" },
  { value: 20, label: "+20%" },
  { value: 25, label: "+25%" },
] as const;

type Mode = "full" | "sample";

/**
 * Otto Tiles–style buy box (ottotiles.co.uk):
 * Sample / size swatches → m² needed + overage → boxes → total.
 */
export function OttoTilesConfigurator({
  pricePerM2,
  samplePrice = 7,
  tilesPerBox,
  tilesPerSqm,
  sizeLabel,
  swatchImage,
  productId,
  productName,
  brandName,
  sku,
  category,
  categoryName,
  leadTimeLabel,
  leadTimeDetail,
  disabled = false,
  onQuantityChange,
  onAddToBasket,
}: {
  pricePerM2: number;
  /** Otto sample SKU price (often ~£7). */
  samplePrice?: number;
  tilesPerBox: number;
  tilesPerSqm: number;
  sizeLabel: string;
  swatchImage?: string;
  productId: string;
  productName: string;
  brandName?: string;
  sku?: string;
  category?: string;
  categoryName?: string;
  leadTimeLabel?: string;
  leadTimeDetail?: string;
  disabled?: boolean;
  onQuantityChange?: (next: OttoOrder) => void;
  onAddToBasket?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("full");
  const [m2Input, setM2Input] = useState("1");
  const [overage, setOverage] = useState(0);

  const unit = Math.max(0, Number(pricePerM2) || 0);
  const box = Math.max(0, Number(tilesPerBox) || 0);
  const perSqm = Math.max(0, Number(tilesPerSqm) || 0);

  const m2Needed = useMemo(
    () => Math.max(0, Number(m2Input) || 0),
    [m2Input],
  );

  const calc = useMemo(
    () =>
      computeOttoOrder({
        m2Needed,
        overagePercent: overage,
        pricePerM2: unit,
        tilesPerBox: box,
        tilesPerSqm: perSqm,
      }),
    [m2Needed, overage, unit, box, perSqm],
  );

  const listPricePerTile = useMemo(
    () => (perSqm > 0 ? round2(unit / perSqm) : 0),
    [unit, perSqm],
  );

  const notify = useRef(onQuantityChange);
  notify.current = onQuantityChange;
  useEffect(() => {
    if (mode === "sample") {
      notify.current?.({
        orderAreaM2: 0,
        total: Math.max(0, Number(samplePrice) || 0),
        packs: 0,
        requestedM2: 0,
        isSample: true,
      });
      return;
    }
    notify.current?.({
      orderAreaM2: calc.totalM2,
      total: calc.total,
      packs: calc.boxes,
      requestedM2: calc.m2Needed,
      isSample: false,
    });
  }, [mode, calc, samplePrice]);

  const bumpM2 = (delta: number) => {
    const next = Math.max(1, Math.min(30, (Number(m2Input) || 1) + delta));
    setM2Input(String(next));
  };

  const quoteHref = buildContactEnquiryHref({
    id: productId,
    name: productName,
    brandName,
    category,
    price: unit,
  });
  const sampleHref = buildSampleRequestHref({
    id: productId,
    name: productName,
    brandName,
    sku,
    category,
    categoryName,
    price: samplePrice,
  });

  const swatch = swatchImage || "";

  return (
    <div
      className={cn(
        "border border-foreground/15 bg-white space-y-5",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      {/* Sample / size swatches */}
      <div className="grid grid-cols-2 gap-3 p-4 pb-0">
        {(
          [
            ["sample", "Sample"],
            ["full", sizeLabel || "Full size"],
          ] as const
        ).map(([key, label]) => {
          const selected = mode === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={cn(
                "flex items-center gap-3 border px-3 py-3 text-left transition-colors",
                selected
                  ? "border-foreground bg-white"
                  : "border-foreground/15 bg-[#faf8f3] hover:border-foreground/35",
              )}
              aria-pressed={selected}
            >
              <span className="relative w-11 h-11 shrink-0 border border-foreground/10 bg-white overflow-hidden">
                {swatch ? (
                  <Image
                    src={swatch}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="44px"
                    unoptimized
                  />
                ) : null}
              </span>
              <span className="text-xs sm:text-sm font-medium leading-snug text-foreground">
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {mode === "sample" ? (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex items-baseline justify-between gap-3 border-t border-foreground/10 pt-4">
            <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-foreground/60">
              Sample price
            </span>
            <span className="text-xl font-bold tabular-nums">
              {formatPrice(Number(samplePrice) || 0)}
            </span>
          </div>
          <p className="text-xs text-foreground/55">
            Tax excluded. Samples are limited to one per tile.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <Link
              href={sampleHref}
              className="h-12 inline-flex items-center justify-center gap-2 bg-foreground text-background text-[11px] font-bold uppercase tracking-[0.16em] hover:bg-foreground/90"
            >
              <Mail className="w-4 h-4" />
              Request sample
            </Link>
            <Link
              href={quoteHref}
              className="h-12 inline-flex items-center justify-center gap-2 border border-foreground text-foreground text-[11px] font-bold uppercase tracking-[0.16em] hover:bg-foreground/5"
            >
              Get a quote
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="px-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-foreground/10 pt-4">
              <Stat
                label={
                  <>
                    Price per m<sup>2</sup>
                  </>
                }
                value={formatPrice(unit)}
              />
              <Stat
                label="Price per tile"
                value={
                  calc.total > 0
                    ? formatPrice(calc.pricePerTile)
                    : formatPrice(listPricePerTile)
                }
              />
              <Stat
                label={
                  <>
                    Total m<sup>2</sup>
                  </>
                }
                value={calc.totalM2 > 0 ? String(calc.totalM2) : "—"}
              />
              <Stat
                label="Tiles / box"
                value={box > 0 ? String(box) : "—"}
              />

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/55">
                  M<sup>2</sup> needed
                </p>
                <div className="flex items-stretch border border-foreground/45 h-10">
                  <button
                    type="button"
                    onClick={() => bumpM2(-1)}
                    className="px-2.5 hover:bg-secondary"
                    aria-label="Decrease m²"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={1}
                    value={m2Input}
                    onChange={(e) => setM2Input(e.target.value)}
                    className="w-full min-w-0 text-center text-sm font-semibold outline-none border-none! tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => bumpM2(1)}
                    className="px-2.5 hover:bg-secondary"
                    aria-label="Increase m²"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/55 inline-flex items-center gap-1.5">
                  Overage
                  <span
                    title="Industry standard suggests adding at least 15% overage due to tile cuts, potential breakage, or future repairs."
                    className="text-foreground/40"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </span>
                </p>
                <select
                  value={overage}
                  onChange={(e) => setOverage(Number(e.target.value) || 0)}
                  className="w-full h-10 border border-foreground/20 bg-white px-2 text-sm font-semibold outline-none"
                >
                  {OVERAGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <Stat
                label="Number of boxes"
                value={calc.boxes > 0 ? String(calc.boxes) : "—"}
                className="col-span-2 sm:col-span-1"
              />
            </div>
          </div>

          <div className="px-4 pb-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-t border-foreground/10 pt-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/55 inline-flex items-center gap-1.5">
                  Total price
                  <span
                    title={
                      calc.boxes > 0
                        ? `${formatPrice(calc.total / calc.boxes)} per box`
                        : "Total for ordered boxes"
                    }
                  >
                    <Info className="w-3.5 h-3.5 text-foreground/40" />
                  </span>
                </p>
                <p className="text-2xl font-bold tabular-nums mt-1">
                  {calc.total > 0 ? formatPrice(calc.total) : "—"}
                </p>
                <p className="text-xs text-foreground/50 mt-0.5">
                  Tax excluded.
                </p>
              </div>
              {(leadTimeLabel || leadTimeDetail) && (
                <div className="text-sm">
                  {leadTimeLabel ? (
                    <p className="font-semibold text-emerald-700">
                      Lead Time: {leadTimeLabel}
                    </p>
                  ) : null}
                  {leadTimeDetail ? (
                    <p className="text-foreground/60 text-xs mt-0.5">
                      {leadTimeDetail}
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                disabled={disabled || calc.boxes <= 0 || calc.total <= 0}
                onClick={() => onAddToBasket?.()}
                className="h-12 inline-flex items-center justify-center gap-2 bg-foreground text-background text-[11px] font-bold uppercase tracking-[0.16em] hover:bg-foreground/90 disabled:opacity-40 disabled:hover:bg-foreground disabled:hover:opacity-40"
              >
                <ShoppingBag className="w-4 h-4" />
                Add to cart
              </button>
              <Link
                href={quoteHref}
                className="h-12 inline-flex items-center justify-center gap-2 bg-foreground text-background text-[11px] font-bold uppercase tracking-[0.16em] hover:bg-foreground/90"
              >
                <Mail className="w-4 h-4" />
                Get a quote
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/55">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

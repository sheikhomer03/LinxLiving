"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { tradeUnitPrice } from "@/lib/trade";

/**
 * Tile Mountain's own quantity calculator, as tilemountain.co.uk runs it.
 *
 * Their buy card does not have a quantity stepper. It has two boxes that are
 * two views of the same order — square metres on one side, the thing that
 * actually ships on the other (a pack for click flooring, a tile or a mosaic
 * sheet for everything else, which they label "Tiles" either way) — and
 * typing in one fills the other:
 *
 *   units = ceil(m² ÷ coverage)        m² = units × coverage
 *
 * The rounding only ever goes up, because part of a pack is not orderable.
 * Pack ranges also carry a floor of one full pack, and say so in the same
 * words they use: "Minimum order must be at least 2.2 m² (one full pack)."
 *
 * "How many do I need?" opens their room helper — length × width, with the
 * wastage allowance offered but not ticked, which is how their modal is
 * configured (`showWastageOnModal`, `preSelectedWastage: false`).
 */

/** Their allowance, offered on the helper rather than applied by default. */
const WASTAGE_PERCENT = 10;

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Units needed to cover `area`. Part of one is not orderable. */
function unitsFor(area: number, coverage: number) {
  if (!(area > 0) || !(coverage > 0)) return 0;
  return Math.ceil(Math.round((area / coverage) * 1e6) / 1e6);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function TileMountainConfigurator({
  pricePerSqm,
  unitPrice,
  unitLabel,
  coverageM2,
  minFullPack = false,
  productName,
  disabled = false,
  onQuantityChange,
  tradeActive = false,
  originalMultiplier = 1,
}: {
  /** Headline £/m² — what their big price reads. */
  pricePerSqm: number;
  /** Price of one orderable unit: a pack, a tile, a mosaic sheet. */
  unitPrice: number;
  /** Their own word for that unit — "Pack" or "Tiles". */
  unitLabel: string;
  /** Square metres one unit covers. */
  coverageM2: number;
  /** Pack ranges cannot be bought below one full pack. */
  minFullPack?: boolean;
  productName?: string;
  disabled?: boolean;
  onQuantityChange?: (next: {
    orderAreaM2: number;
    total: number;
    packs: number;
  }) => void;
  /** Trade Mode reduces what is shown; the cart re-applies it itself. */
  tradeActive?: boolean;
  /** Scales a total up to its pre-sale figure for the "Was" line. */
  originalMultiplier?: number;
}) {
  const [areaInput, setAreaInput] = useState("");
  const [unitsInput, setUnitsInput] = useState("");
  const [helperOpen, setHelperOpen] = useState(false);
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [addWastage, setAddWastage] = useState(false);

  const isPack = /pack/i.test(unitLabel);

  /** Whole units the order rounds up to, and the area they cover. */
  const units = Math.max(0, Number(unitsInput) || 0);
  const requestedM2 = Math.max(0, Number(areaInput) || 0);
  const orderAreaM2 = round2(units * coverageM2);
  const total = round2(units * unitPrice);

  /** Below one full pack their card refuses the order and says so. */
  const belowMinimum = minFullPack && requestedM2 > 0 && requestedM2 < coverageM2;

  const shownTotal = tradeActive ? tradeUnitPrice(total, true) : total;
  const wasTotal =
    originalMultiplier > 1 ? round2(shownTotal * originalMultiplier) : null;

  /** Typing an area fills the unit box, and the other way round. */
  const setFromArea = (raw: string) => {
    setAreaInput(raw);
    const m2 = Math.max(0, Number(raw) || 0);
    setUnitsInput(m2 > 0 ? String(unitsFor(m2, coverageM2)) : "");
  };
  const setFromUnits = (raw: string) => {
    setUnitsInput(raw);
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    setAreaInput(n > 0 ? String(round2(n * coverageM2)) : "");
  };

  /** The helper's room sum, with their optional allowance on top. */
  const helperArea = useMemo(() => {
    const l = Number(length) || 0;
    const w = Number(width) || 0;
    const a = l * w;
    if (!(a > 0)) return 0;
    return round2(addWastage ? a * (1 + WASTAGE_PERCENT / 100) : a);
  }, [length, width, addWastage]);

  const report = useRef(onQuantityChange);
  report.current = onQuantityChange;
  useEffect(() => {
    report.current?.(
      units > 0 ? { orderAreaM2, total, packs: units } : { orderAreaM2: 0, total: 0, packs: 0 },
    );
  }, [units, orderAreaM2, total]);

  const inputClass =
    "h-12 w-24 border border-black/20 px-3 text-center text-[15px] text-black " +
    "focus:border-black focus:outline-none disabled:bg-black/5";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[26px] leading-none text-black">
            {formatPrice(pricePerSqm)}
            <span className="text-[15px] text-black/60">/sqm</span>
          </p>
          {isPack ? (
            <p className="mt-3 text-[14px] font-medium text-black">
              {formatPrice(unitPrice)}{" "}
              <span className="font-normal text-black/60">per pack.</span>
            </p>
          ) : null}
        </div>

        <div className="flex items-start gap-3">
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={areaInput}
                disabled={disabled}
                onChange={(e) => setFromArea(e.target.value)}
                className={inputClass}
                aria-label="Square metres required"
              />
              <span className="font-menu text-[12px] uppercase tracking-[1.2px] text-black">
                m²
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={unitsInput}
                disabled={disabled}
                onChange={(e) => setFromUnits(e.target.value)}
                className={inputClass}
                aria-label={`${unitLabel} required`}
              />
              <span className="font-menu text-[12px] uppercase tracking-[1.2px] text-black">
                {unitLabel}
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setHelperOpen((v) => !v)}
            className="flex w-24 flex-col items-center gap-1 pt-1 text-center"
          >
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center bg-[#2b2a6b] text-[15px] leading-none text-white"
            >
              <span className="grid grid-cols-2 gap-x-1 gap-y-0.5 text-[11px]">
                <span>+</span>
                <span>−</span>
                <span>×</span>
                <span>=</span>
              </span>
            </span>
            <span className="text-[12px] underline underline-offset-2 text-black">
              How many do I need?
            </span>
          </button>
        </div>
      </div>

      {belowMinimum ? (
        <p className="text-[13px] text-[#c8102e]">
          Minimum order must be at least {coverageM2} m² (one full pack). Please increase
          the quantity.
        </p>
      ) : null}

      {helperOpen ? (
        <div className="space-y-4 border border-black/15 p-4">
          <p className="font-menu text-[12px] uppercase tracking-[1.2px] text-black">
            Calculate area
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-[12px] text-black/60">Length (m)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                className={inputClass}
              />
            </label>
            <span className="pb-3 text-black/40">×</span>
            <label className="space-y-1">
              <span className="block text-[12px] text-black/60">Width (m)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-black">
            <input
              type="checkbox"
              checked={addWastage}
              onChange={(e) => setAddWastage(e.target.checked)}
              className="h-4 w-4 accent-black"
            />
            Add {WASTAGE_PERCENT}% for wastage
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-black">
              {helperArea > 0 ? `${helperArea} m²` : "—"}
            </p>
            <button
              type="button"
              disabled={!(helperArea > 0)}
              onClick={() => {
                setFromArea(String(helperArea));
                setHelperOpen(false);
              }}
              className={cn(
                "font-menu h-11 px-5 text-[12px] font-medium uppercase tracking-[1.2px]",
                helperArea > 0
                  ? "bg-black text-white"
                  : "cursor-not-allowed bg-black/10 text-black/40",
              )}
            >
              Use this area
            </button>
          </div>
        </div>
      ) : null}

      {units > 0 ? (
        <div className="flex items-baseline justify-between border-t border-black/10 pt-3">
          <p className="text-[13px] text-black/60">
            {units} {isPack ? (units === 1 ? "pack" : "packs") : unitLabel.toLowerCase()} ·{" "}
            {orderAreaM2} m²
            {productName ? "" : ""}
          </p>
          <p className="text-[18px] text-black">
            {wasTotal != null ? (
              <span className="mr-2 text-[13px] text-black/30 line-through">
                {formatPrice(wasTotal)}
              </span>
            ) : null}
            {formatPrice(shownTotal)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

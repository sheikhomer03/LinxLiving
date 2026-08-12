"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { tradeUnitPrice } from "@/lib/trade";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function round2(n: number) {
  return Math.round(Math.max(0, n) * 100) / 100;
}

/**
 * Natura Flooring–style m² buy box (matches naturaflooring.co.uk):
 * area input, optional length × width helper, live total inc. VAT.
 *
 * Engineered wood ships in packs, so an order rounds up to whole packs the
 * way naturaflooring.co.uk does — asking for 1m² of a 2.614m² pack charges
 * for the pack. Without `packCoverageM2` it falls back to charging pro-rata,
 * which is what it did before pack sizes were recorded.
 */
export function NaturaAreaConfigurator({
  pricePerM2,
  packCoverageM2,
  onQuantityChange,
  disabled = false,
  tradeActive = false,
  originalMultiplier = 1,
}: {
  /** Selling price per m² (inc. VAT). */
  pricePerM2: number;
  /** m² covered by one pack. Omitted → no rounding. */
  packCoverageM2?: number | null;
  onQuantityChange?: (next: { orderAreaM2: number; total: number }) => void;
  disabled?: boolean;
  /** Self-serve Trade Mode — the total shown here reflects the reduction,
      but `onQuantityChange` always reports the true (pre-trade) total, since
      the cart re-applies the discount itself from the account/toggle state. */
  tradeActive?: boolean;
  /** Scales the total up to what it would be at the true pre-sale price, for
      the "Was" figure — 1 when there's no sale on top of trade. */
  originalMultiplier?: number;
}) {
  const unit = Math.max(0, Number(pricePerM2) || 0);
  const packM2 = Number(packCoverageM2);
  const hasPacks = Number.isFinite(packM2) && packM2 > 0;
  const [areaInput, setAreaInput] = useState("0");
  /** Trade standard: 10% extra for cuts, breakages and future repairs. */
  const [wastage, setWastage] = useState(true);
  const [helpCalc, setHelpCalc] = useState(false);
  const [lengthInput, setLengthInput] = useState("0");
  const [widthInput, setWidthInput] = useState("0");

  const areaM2 = useMemo(
    () => round2(Number(areaInput) || 0),
    [areaInput],
  );
  /** Whole packs needed to cover the area — what the customer is charged for. */
  /** Area to cover once the wastage allowance is applied. */
  const requiredM2 = useMemo(
    () => (wastage ? areaM2 * 1.1 : areaM2),
    [areaM2, wastage],
  );
  const packs = useMemo(
    () => (hasPacks && requiredM2 > 0 ? Math.ceil(requiredM2 / packM2) : 0),
    [requiredM2, hasPacks, packM2],
  );
  /**
   * Area supplied once rounded up to whole packs.
   *
   * Kept unrounded for the arithmetic — rounding to 2dp first and then
   * multiplying loses 43p on a 2.614m² pack, so the total would no longer
   * equal pack price × packs. `billedM2Display` is the rounded version, used
   * only for the label.
   */
  const billedM2 = useMemo(
    () => (hasPacks ? packs * packM2 : requiredM2),
    [hasPacks, packs, packM2, requiredM2],
  );
  const billedM2Display = round2(billedM2);
  const total = useMemo(
    () => Math.round(billedM2 * unit * 100) / 100,
    [billedM2, unit],
  );

  const notify = useRef(onQuantityChange);
  notify.current = onQuantityChange;
  useEffect(() => {
    // Report the billed area, not the requested one — the basket must match
    // the price shown.
    notify.current?.({ orderAreaM2: billedM2, total });
  }, [billedM2, total]);

  const syncAreaFromRoom = (lengthRaw: string, widthRaw: string) => {
    const length = Math.max(0, Number(lengthRaw) || 0);
    const width = Math.max(0, Number(widthRaw) || 0);
    setAreaInput(String(round2(length * width)));
  };

  return (
    <div
      className={cn(
        "rounded-none border border-[#d9d4cb] bg-[#f4f0e8]",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-[1.35fr_1fr]">
        <div className="space-y-3 p-4 sm:p-5">
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-[#2b3a4a]">
              Number of m² required
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={areaInput}
              disabled={disabled}
              onChange={(e) => setAreaInput(e.target.value)}
              className="w-full max-w-44 border border-[#c9c3b8] bg-white px-3 py-2 text-sm text-[#2b3a4a] outline-none focus:border-[#2b3a4a]"
            />
          </label>

          {helpCalc ? (
            <>
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium text-[#2b3a4a]">
                  Room length (meters)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={lengthInput}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = e.target.value;
                    setLengthInput(next);
                    syncAreaFromRoom(next, widthInput);
                  }}
                  className="w-full max-w-44 border border-[#c9c3b8] bg-white px-3 py-2 text-sm text-[#2b3a4a] outline-none focus:border-[#2b3a4a]"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium text-[#2b3a4a]">
                  Room width (meters)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={widthInput}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = e.target.value;
                    setWidthInput(next);
                    syncAreaFromRoom(lengthInput, next);
                  }}
                  className="w-full max-w-44 border border-[#c9c3b8] bg-white px-3 py-2 text-sm text-[#2b3a4a] outline-none focus:border-[#2b3a4a]"
                />
              </label>
            </>
          ) : null}

          <label className="flex items-center gap-2.5 cursor-pointer select-none pt-0.5">
            <input
              type="checkbox"
              checked={helpCalc}
              disabled={disabled}
              onChange={(e) => {
                const checked = e.target.checked;
                setHelpCalc(checked);
                if (checked) {
                  syncAreaFromRoom(lengthInput, widthInput);
                }
              }}
              className="h-4 w-4 accent-[#2b6cb0]"
            />
            <span className="text-sm text-[#2b3a4a]">Help calculating m²</span>
          </label>

          <label className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={wastage}
              disabled={disabled}
              onChange={(e) => setWastage(e.target.checked)}
              className="h-4 w-4 accent-[#2b6cb0]"
            />
            <span className="text-sm text-[#2b3a4a]">
              Wastage allowance{" "}
              <span className="text-[#2b3a4a]/60">
                (+10% for cuts &amp; breakages)
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col justify-center border-t border-[#d9d4cb] px-4 py-5 sm:border-t-0 sm:border-l sm:px-6">
          <p className="text-sm font-medium text-[#2b3a4a]">Total:</p>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            {tradeActive ? (
              <span className="text-base font-medium text-[#2b3a4a]/45 line-through">
                Was {formatPrice(total * originalMultiplier)}
              </span>
            ) : null}
            <span className="text-3xl font-bold tracking-tight text-[#1a1a1a]">
              {formatPrice(tradeActive ? tradeUnitPrice(total, true) : total)}
            </span>
            <span className="text-sm text-[#2b3a4a]">Inc VAT</span>
          </div>
          {/* Say what is actually supplied — the customer asked for one area
              and is charged for whole packs, so the difference must be
              visible rather than a surprise at checkout. */}
          {hasPacks && packs > 0 ? (
            <p className="mt-1.5 text-[12px] text-[#2b3a4a]/70">
              {packs} pack{packs === 1 ? "" : "s"} ·{" "}
              {billedM2Display.toFixed(2)}m² supplied
              {billedM2 > areaM2
                ? ` (covers your ${areaM2.toFixed(2)}m²${wastage ? " + 10%" : ""})`
                : ""}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

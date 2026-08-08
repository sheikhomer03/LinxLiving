"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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
 */
export function NaturaAreaConfigurator({
  pricePerM2,
  onQuantityChange,
  disabled = false,
}: {
  /** Selling price per m² (inc. VAT). */
  pricePerM2: number;
  onQuantityChange?: (next: { orderAreaM2: number; total: number }) => void;
  disabled?: boolean;
}) {
  const unit = Math.max(0, Number(pricePerM2) || 0);
  const [areaInput, setAreaInput] = useState("0");
  const [helpCalc, setHelpCalc] = useState(false);
  const [lengthInput, setLengthInput] = useState("0");
  const [widthInput, setWidthInput] = useState("0");

  const areaM2 = useMemo(
    () => round2(Number(areaInput) || 0),
    [areaInput],
  );
  const total = useMemo(
    () => Math.round(areaM2 * unit * 100) / 100,
    [areaM2, unit],
  );

  const notify = useRef(onQuantityChange);
  notify.current = onQuantityChange;
  useEffect(() => {
    notify.current?.({ orderAreaM2: areaM2, total });
  }, [areaM2, total]);

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
              className="w-full max-w-[11rem] border border-[#c9c3b8] bg-white px-3 py-2 text-sm text-[#2b3a4a] outline-none focus:border-[#2b3a4a]"
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
                  className="w-full max-w-[11rem] border border-[#c9c3b8] bg-white px-3 py-2 text-sm text-[#2b3a4a] outline-none focus:border-[#2b3a4a]"
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
                  className="w-full max-w-[11rem] border border-[#c9c3b8] bg-white px-3 py-2 text-sm text-[#2b3a4a] outline-none focus:border-[#2b3a4a]"
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
        </div>

        <div className="flex flex-col justify-center border-t border-[#d9d4cb] px-4 py-5 sm:border-t-0 sm:border-l sm:px-6">
          <p className="text-sm font-medium text-[#2b3a4a]">Total:</p>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-bold tracking-tight text-[#1a1a1a]">
              {formatPrice(total)}
            </span>
            <span className="text-sm text-[#2b3a4a]">Inc VAT</span>
          </div>
        </div>
      </div>
    </div>
  );
}

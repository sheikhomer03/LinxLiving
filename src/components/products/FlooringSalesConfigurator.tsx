"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type FslAddonField = {
  id?: string;
  type?: string;
  label?: string;
  required?: boolean;
  unit?: string;
  defaultValue?: string;
};

export type FslAddonGroup = {
  id?: string;
  heading?: string;
  mode?: string;
  fields?: FslAddonField[];
};

type Props = {
  /** Supplier add-on form, so wording matches their PDP exactly. */
  addonGroups?: FslAddonGroup[];
  /** Price of one pack. */
  pricePerPack: number;
  /** Area a single pack covers. */
  packCoverageM2: number;
  /** e.g. "Available on backorder" — shown above the calculator as on their site. */
  stockLabel?: string;
  disabled?: boolean;
  onChange?: (next: { packs: number; coveredM2: number; total: number }) => void;
};

/**
 * Flooring Sales buy box — their Measurement Price Calculator: enter an area,
 * it rounds up to whole packs and prices them, with the pack quantity and
 * stock status shown the way their PDP does.
 */
export function FlooringSalesConfigurator({
  addonGroups = [],
  pricePerPack,
  packCoverageM2,
  stockLabel = "",
  disabled = false,
  onChange,
}: Props) {
  const packPrice = Math.max(0, Number(pricePerPack) || 0);
  const coverage = Math.max(0, Number(packCoverageM2) || 0);
  const [areaInput, setAreaInput] = useState("");
  const [packInput, setPackInput] = useState("1");
  /** Which box the customer typed in last, so the two stay in step. */
  const [lastEdited, setLastEdited] = useState<"area" | "packs" | null>(null);

  const fields = useMemo(
    () => (addonGroups || []).flatMap((g) => g.fields || []),
    [addonGroups],
  );
  /** Labels come from the supplier's own form, with sane fallbacks. */
  const labelFor = (id: string, fallback: string) =>
    fields.find((f) => f.id === id)?.label?.trim() || fallback;
  const unitFor = (id: string, fallback: string) =>
    fields.find((f) => f.id === id)?.unit?.trim() || fallback;

  // Their calculator waits 250ms after the last keystroke before recalculating.
  const [debouncedArea, setDebouncedArea] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedArea(areaInput), 250);
    return () => clearTimeout(t);
  }, [areaInput]);

  const requestedM2 =
    Number(String(debouncedArea).replace(/[^0-9.]/g, "")) || 0;

  /**
   * Area → packs is derived rather than synced through state, so the two boxes
   * never fight: whichever the customer typed last wins.
   */
  const packsFromArea =
    requestedM2 > 0 && coverage > 0
      ? Math.ceil(round2(requestedM2 / coverage))
      : 0;
  const packsShown =
    lastEdited === "area" && packsFromArea > 0 ? String(packsFromArea) : packInput;
  const packs = Math.max(0, Math.floor(Number(packsShown) || 0));
  const coveredM2 = useMemo(() => round2(packs * coverage), [packs, coverage]);
  const total = useMemo(() => round2(packs * packPrice), [packs, packPrice]);

  useEffect(() => {
    onChange?.({ packs, coveredM2, total });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packs, coveredM2, total]);

  if (!(packPrice > 0) || !(coverage > 0)) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-foreground/15 bg-white",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <div className="space-y-4 p-4 sm:p-5">
        {stockLabel ? (
          <p className="text-sm font-semibold text-[#2e7d32]">{stockLabel}</p>
        ) : null}

        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-foreground/10">
              <td className="py-2 pr-3 font-semibold">
                {labelFor("area_needed", "Required Area")}{" "}
                <span className="font-normal text-foreground/55">
                  ({unitFor("area_needed", "sq m")})
                </span>
              </td>
              <td className="py-2 text-right">
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={labelFor("area_needed", "Required Area")}
                  title="Please enter the desired amount with this format: 1234.56"
                  value={areaInput}
                  disabled={disabled}
                  onChange={(e) => {
                    setLastEdited("area");
                    setAreaInput(e.target.value);
                  }}
                  className="w-28 border border-foreground/25 px-2 py-1.5 text-right outline-none focus:border-foreground/60"
                />
              </td>
            </tr>
            <tr className="border-b border-foreground/10">
              <td className="py-2 pr-3 font-semibold">
                {labelFor("area_actual", "Actual meterage to be supplied")}
              </td>
              <td className="py-2 text-right tabular-nums">
                {packs > 0 ? coveredM2 : coverage}
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-3 font-semibold">
                {labelFor("total_price", "Total Price")}
              </td>
              <td className="py-2 text-right font-bold tabular-nums">
                {formatPrice(packs > 0 ? total : packPrice)}
              </td>
            </tr>
          </tbody>
        </table>

        <div>
          <div>
            <p className="mb-1 text-sm font-semibold">
              {labelFor("quantity", "Packs")}
            </p>
            <input
              type="number"
              min={1}
              step={1}
              aria-label="Packs"
              value={packsShown}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.value;
                setLastEdited("packs");
                setPackInput(next);
                const n = Math.max(0, Math.floor(Number(next) || 0));
                // Mirror the area the chosen packs cover.
                setAreaInput(n > 0 && coverage > 0 ? String(round2(n * coverage)) : "");
              }}
              className="w-24 border border-foreground/25 px-2 py-2 outline-none focus:border-foreground/60"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

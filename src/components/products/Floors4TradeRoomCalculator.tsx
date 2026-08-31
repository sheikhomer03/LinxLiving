"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Floors4Trade's room-by-room calculator.
 *
 * Their trade buyers price a job a room at a time and quote each room against
 * its own reference ("Mrs Smith Lounge", "Plot 12 Kitchen"), so the reference
 * is part of the result rather than a note bolted on afterwards.
 *
 * The arithmetic is theirs: area comes either from length × width or a total
 * the fitter already holds, an allowance is added on top, and the result is
 * rounded **up** to whole packs — a pack is the smallest thing anyone can buy,
 * so a room needing 2.1 packs needs three. Price per m² is derived from the
 * pack price rather than stored separately, which keeps it honest when the
 * pack price changes.
 */
export function Floors4TradeRoomCalculator({
  packPrice,
  packCoverageM2,
  productName,
  disabled = false,
  onQuantityChange,
}: {
  /** Price of one pack, ex VAT. */
  packPrice: number;
  /** m² a single pack lays. */
  packCoverageM2: number;
  productName?: string;
  disabled?: boolean;
  onQuantityChange?: (next: { packs: number; areaM2: number; total: number }) => void;
}) {
  const [roomRef, setRoomRef] = useState("");
  const [mode, setMode] = useState<"dims" | "area">("dims");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [totalArea, setTotalArea] = useState("");
  const [allowance, setAllowance] = useState<number | "custom">(0);
  const [customAllowance, setCustomAllowance] = useState("");
  const [shown, setShown] = useState(false);

  const n = (v: string) => {
    const x = Number.parseFloat(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
  };

  const baseArea = useMemo(
    () => (mode === "dims" ? n(length) * n(width) : n(totalArea)),
    [mode, length, width, totalArea],
  );

  const allowancePct = allowance === "custom" ? Math.min(n(customAllowance), 50) : allowance;

  const result = useMemo(() => {
    if (!(baseArea > 0) || !(packCoverageM2 > 0)) return null;
    const withAllowance = baseArea * (1 + allowancePct / 100);
    const packs = Math.ceil(withAllowance / packCoverageM2);
    const supplied = packs * packCoverageM2;
    const total = packs * packPrice;
    return {
      baseArea,
      withAllowance,
      packs,
      supplied,
      total,
      perM2: packCoverageM2 > 0 ? packPrice / packCoverageM2 : 0,
    };
  }, [baseArea, allowancePct, packCoverageM2, packPrice]);

  const money = (v: number) =>
    `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  function calculate() {
    if (!result) return;
    setShown(true);
    onQuantityChange?.({ packs: result.packs, areaM2: result.supplied, total: result.total });
  }

  const chip = (on: boolean) =>
    cn(
      "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
      on
        ? "border-foreground bg-foreground text-background"
        : "border-foreground/15 bg-white text-foreground hover:border-foreground/40",
    );

  return (
    <div className="rounded-xl border border-foreground/10 bg-white p-5 space-y-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide">Room-by-room calculator</p>
        <p className="text-xs text-foreground/60">Price each room to its own job reference</p>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">1 · Room / job reference</span>
        <input
          type="text"
          value={roomRef}
          maxLength={80}
          onChange={(e) => setRoomRef(e.target.value)}
          placeholder="e.g. Mrs Smith Lounge · Plot 12 Kitchen"
          className="w-full rounded-lg border border-foreground/15 px-3 py-2 text-sm"
        />
      </label>

      <div className="space-y-2">
        <span className="text-sm font-medium">2 · Choose how to calculate</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(mode === "dims")} onClick={() => setMode("dims")}>
            Enter room dimensions
          </button>
          <button type="button" className={chip(mode === "area")} onClick={() => setMode("area")}>
            Enter total m²
          </button>
        </div>

        {mode === "dims" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-foreground/70">Room length (m)</span>
              <input
                type="number" min="0" step="0.1" value={length}
                onChange={(e) => setLength(e.target.value)} placeholder="e.g. 5"
                className="w-full rounded-lg border border-foreground/15 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-foreground/70">Room width (m)</span>
              <input
                type="number" min="0" step="0.1" value={width}
                onChange={(e) => setWidth(e.target.value)} placeholder="e.g. 4"
                className="w-full rounded-lg border border-foreground/15 px-3 py-2 text-sm"
              />
            </label>
          </div>
        ) : (
          <label className="space-y-1 block">
            <span className="text-xs text-foreground/70">Total area required (m²)</span>
            <input
              type="number" min="0" step="0.1" value={totalArea}
              onChange={(e) => setTotalArea(e.target.value)} placeholder="e.g. 22.5"
              className="w-full rounded-lg border border-foreground/15 px-3 py-2 text-sm"
            />
          </label>
        )}

        {mode === "dims" && baseArea > 0 ? (
          <p className="text-xs text-foreground/70">
            Calculated room area: <strong>{baseArea.toFixed(2)} m²</strong>
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Allowance</span>
        <div className="flex flex-wrap gap-2">
          {([0, 5, 10] as const).map((a) => (
            <button key={a} type="button" className={chip(allowance === a)} onClick={() => setAllowance(a)}>
              {a === 0 ? "No allowance" : `${a}%`}
            </button>
          ))}
          <button type="button" className={chip(allowance === "custom")} onClick={() => setAllowance("custom")}>
            Custom
          </button>
        </div>
        {allowance === "custom" ? (
          <label className="space-y-1 block">
            <span className="text-xs text-foreground/70">Custom allowance %</span>
            <input
              type="number" min="0" max="50" step="1" value={customAllowance}
              onChange={(e) => setCustomAllowance(e.target.value)} placeholder="e.g. 7"
              className="w-full rounded-lg border border-foreground/15 px-3 py-2 text-sm"
            />
          </label>
        ) : null}
      </div>

      <button
        type="button"
        onClick={calculate}
        disabled={disabled || !result}
        className="w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-40"
      >
        Calculate packs required
      </button>

      {shown && result ? (
        <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-4 text-sm space-y-1.5">
          <p className="font-semibold">Room summary</p>
          {roomRef ? (
            <Row label="Room reference" value={roomRef} />
          ) : null}
          <Row label="Area entered" value={`${result.baseArea.toFixed(2)} m²`} />
          <Row
            label="Allowance added"
            value={allowancePct > 0 ? `${allowancePct}% (${result.withAllowance.toFixed(2)} m²)` : "None"}
          />
          <Row label="Packs required" value={String(result.packs)} />
          <Row label="Coverage supplied" value={`${result.supplied.toFixed(2)} m²`} />
          <Row label="Price per m²" value={`${money(result.perM2)} ex VAT`} />
          <Row label="Price per pack" value={`${money(packPrice)} ex VAT`} />
          <div className="flex items-center justify-between border-t border-foreground/10 pt-2 font-semibold">
            <span>Total ex VAT</span>
            <span>{money(result.total)}</span>
          </div>
          {productName ? (
            <p className="pt-1 text-xs text-foreground/50">{productName}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-foreground/70">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}

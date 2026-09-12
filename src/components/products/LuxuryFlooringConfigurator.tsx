"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { tradeUnitPrice } from "@/lib/trade";

/**
 * Luxury Flooring's own pack calculator, as luxuryflooring.co.uk runs it.
 *
 * Their PDP does not sell by the square metre: you say how many m² the room
 * needs and it converts that to whole packs, because a pack is what ships. The
 * arithmetic here is theirs, kept deliberately literal so the two sites quote
 * the same basket for the same room:
 *
 *   packs = max(1, ceil(area ÷ coverage))
 *   billed area = coverage × packs
 *
 * Wastage is the part worth being careful about. They do not add 10% to the
 * area and round that up — they work out both figures and compare the pack
 * counts. Where the rounding has already bought the extra (a 10 m² room out of
 * 1.956 m² packs needs 6 packs either way) the option is not offered at all
 * and the page says the wastage is already covered, rather than charging for a
 * pack nobody needs. That is why `wastageCovered` exists rather than a plain
 * multiplier.
 */

/** The copy their tooltip shows, kept as they word it. */
const WASTAGE_EXPLAINER =
  "When working out how much flooring to buy, it's important to add on a bit extra. This is because each room is unique in its size and shape and often you'll have to cut several boards to accommodate this. This extra allowance is known as 'wastage'.";

/** Their default, and the figure the checkbox offers. */
const WASTAGE_PERCENT = 10;

/** Remembers the tick across products, as their storefront does. */
const WASTAGE_STORAGE_KEY = "linx:wastage_checked_status";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Packs needed to cover `area`, never fewer than one. Their rounding. */
function packsFor(area: number, coverage: number) {
  if (!(area > 0) || !(coverage > 0)) return 0;
  const exact = area / coverage;
  const floor = Math.floor(exact);
  return Math.max(1, floor < exact ? floor + 1 : floor);
}

export function LuxuryFlooringConfigurator({
  coverage,
  pricePerPack,
  productName,
  disabled = false,
  onQuantityChange,
  tradeActive = false,
  originalMultiplier = 1,
}: {
  /** Square metres one pack covers. */
  coverage: number;
  /** Price of a single pack, inc VAT — what `price` holds for this brand. */
  pricePerPack: number;
  productName?: string;
  disabled?: boolean;
  onQuantityChange?: (next: {
    orderAreaM2: number;
    total: number;
    packs: number;
    requestedM2: number;
  }) => void;
  /** Trade Mode reduces what is shown; the cart re-applies it from account state. */
  tradeActive?: boolean;
  /** Scales a total back up to its pre-sale figure for the "Was" line. */
  originalMultiplier?: number;
}) {
  const [areaInput, setAreaInput] = useState("");
  const [includeWastage, setIncludeWastage] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [showRoomHelper, setShowRoomHelper] = useState(false);
  const [roomLength, setRoomLength] = useState("");
  const [roomWidth, setRoomWidth] = useState("");

  // Their storefront keeps the tick in localStorage so it survives the next
  // product. Read after mount: the server render has no window.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(WASTAGE_STORAGE_KEY);
      if (saved !== null) setIncludeWastage(saved === "true");
    } catch {
      /* private browsing refuses storage; the default stands */
    }
  }, []);

  const requested = Math.max(0, Number(areaInput) || 0);

  const quote = useMemo(() => {
    if (!(requested > 0) || !(coverage > 0)) {
      return {
        packs: 0,
        area: 0,
        basePacks: 0,
        wastagePacks: 0,
        wastageCovered: false,
        extraCost: 0,
      };
    }
    const basePacks = packsFor(requested, coverage);
    const withWastage = requested + (requested * WASTAGE_PERCENT) / 100;
    const wastagePacks = packsFor(withWastage, coverage);
    // Rounding up to whole packs often supplies the wastage by itself.
    const wastageCovered = basePacks === wastagePacks;
    const packs =
      includeWastage && !wastageCovered ? wastagePacks : basePacks;
    return {
      packs,
      area: Math.round(coverage * packs * 100) / 100,
      basePacks,
      wastagePacks,
      wastageCovered,
      extraCost: pricePerPack * (wastagePacks - basePacks),
    };
  }, [requested, coverage, includeWastage, pricePerPack]);

  const trueTotal = Math.round(quote.packs * pricePerPack * 100) / 100;
  const shownTotal = tradeActive
    ? tradeUnitPrice(trueTotal, tradeActive)
    : trueTotal;
  const wasTotal =
    originalMultiplier > 1
      ? Math.round(shownTotal * originalMultiplier * 100) / 100
      : null;

  // The cart is told the true, pre-trade total; it re-applies trade itself.
  const notify = useRef(onQuantityChange);
  notify.current = onQuantityChange;
  useEffect(() => {
    notify.current?.({
      orderAreaM2: quote.area,
      total: trueTotal,
      packs: quote.packs,
      requestedM2: requested,
    });
  }, [quote.area, quote.packs, trueTotal, requested]);

  const setWastage = (next: boolean) => {
    setIncludeWastage(next);
    try {
      window.localStorage.setItem(WASTAGE_STORAGE_KEY, String(next));
    } catch {
      /* nothing to remember it with; the session still works */
    }
  };

  const roomArea =
    (Number(roomLength) || 0) > 0 && (Number(roomWidth) || 0) > 0
      ? Math.round(Number(roomLength) * Number(roomWidth) * 100) / 100
      : 0;

  const pricePerM2 = coverage > 0 ? pricePerPack / coverage : 0;

  return (
    <div className="rounded-xl border border-foreground/10 bg-white p-5 space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          Number of m² required
        </h3>
        <p className="text-xs text-muted-foreground">
          {formatPrice(pricePerPack)} per pack · covers{" "}
          {coverage.toLocaleString("en-GB", { maximumFractionDigits: 3 })} m²
          {pricePerM2 > 0 ? ` · ${formatPrice(pricePerM2)}/m²` : ""}
        </p>
      </div>

      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={areaInput}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value;
              // Their field refuses negatives outright rather than clamping on
              // submit, so a stray minus never reaches the pack maths.
              setAreaInput(Number(raw) < 0 ? "0" : raw);
            }}
            placeholder="0"
            aria-label="Number of square metres required"
            className="w-full rounded-lg border border-foreground/45 px-3 py-2.5 pr-12 text-sm outline-none focus:border-foreground disabled:opacity-50"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            m²
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowRoomHelper((v) => !v)}
          className="shrink-0 rounded-lg border border-foreground/20 px-3 text-xs font-semibold text-foreground hover:bg-secondary transition-colors"
        >
          How much do I need?
        </button>
      </div>

      {showRoomHelper ? (
        <div className="rounded-lg border border-foreground/10 bg-[#fafafa] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-foreground">
              Measure your room
            </span>
            <button
              type="button"
              onClick={() => setShowRoomHelper(false)}
              aria-label="Close room calculator"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-muted-foreground">
              Length (m)
              <input
                type="number"
                min={0}
                step="0.01"
                value={roomLength}
                onChange={(e) => setRoomLength(e.target.value)}
                className="mt-1 w-full rounded-lg border border-foreground/30 px-3 py-2 text-sm text-foreground outline-none focus:border-foreground"
              />
            </label>
            <span className="pb-2.5 text-muted-foreground">×</span>
            <label className="flex-1 text-xs text-muted-foreground">
              Width (m)
              <input
                type="number"
                min={0}
                step="0.01"
                value={roomWidth}
                onChange={(e) => setRoomWidth(e.target.value)}
                className="mt-1 w-full rounded-lg border border-foreground/30 px-3 py-2 text-sm text-foreground outline-none focus:border-foreground"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={roomArea <= 0}
            onClick={() => {
              setAreaInput(String(roomArea));
              setShowRoomHelper(false);
            }}
            className="w-full rounded-lg bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-widest text-background disabled:opacity-40"
          >
            {roomArea > 0 ? `Use ${roomArea} m²` : "Enter both measurements"}
          </button>
        </div>
      ) : null}

      {quote.packs > 0 ? (
        <>
          {quote.wastageCovered ? (
            <p className="flex items-center gap-2 text-xs font-medium text-foreground">
              <span className="inline-block h-4 w-4 rounded-full bg-foreground/80 text-center text-[10px] leading-4 text-background">
                ✓
              </span>
              Includes {WASTAGE_PERCENT}% wastage
              <button
                type="button"
                onClick={() => setShowExplainer((v) => !v)}
                aria-label="What is wastage?"
                className="text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </p>
          ) : (
            <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={includeWastage}
                disabled={disabled}
                onChange={(e) => setWastage(e.target.checked)}
                className="h-4 w-4 accent-foreground"
              />
              Add {WASTAGE_PERCENT}% wastage
              {quote.extraCost > 0 ? (
                <span className="text-muted-foreground">
                  (+{formatPrice(quote.extraCost)})
                </span>
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setShowExplainer((v) => !v);
                }}
                aria-label="What is wastage?"
                className="text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </label>
          )}

          {showExplainer ? (
            <div className="rounded-lg border border-foreground/10 bg-[#fafafa] p-3 text-xs text-muted-foreground">
              <span className="mb-1 block font-semibold text-foreground">
                What is wastage?
              </span>
              {WASTAGE_EXPLAINER}
            </div>
          ) : null}

          <div className="flex items-end justify-between gap-4 border-t border-foreground/10 pt-3">
            <div>
              <span className="block text-xs uppercase tracking-widest text-muted-foreground">
                Total
              </span>
              <span className="text-xs text-muted-foreground">
                ({quote.packs} pack{quote.packs === 1 ? "" : "s"} /{" "}
                {quote.area.toLocaleString("en-GB", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                m²)
              </span>
            </div>
            <div className="text-right">
              {wasTotal ? (
                <span className="mr-2 text-sm text-muted-foreground line-through">
                  {formatPrice(wasTotal)}
                </span>
              ) : null}
              <span
                className={cn(
                  "text-2xl font-bold",
                  tradeActive ? "text-[#0F7B4F]" : "text-foreground",
                )}
              >
                {formatPrice(shownTotal)}
              </span>
              <span className="ml-1 text-xs text-muted-foreground">inc. VAT</span>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Enter the area you need and we&apos;ll work out the packs
          {productName ? ` of ${productName}` : ""}.
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WASTAGE_PERCENT,
  quoteByArea,
  areaFromTiles,
  tileAreaFromSize,
  parseSqmPerBox,
  pricePerSqmFrom,
} from "@/lib/tileCalculator";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Quantity + live price for products sold by the m².
 *
 * Replaces the plain quantity stepper on tile/flooring products. All pricing
 * comes from the product being viewed, so each brand prices itself.
 */
export function ProductAreaCalculator({
  price,
  size,
  sqmPerBox,
  onQuantityChange,
  disabled = false,
}: {
  /** The product's listed price — a box price when box coverage is known. */
  price: number;
  size?: string | null;
  sqmPerBox?: string | number | null;
  /** Reports the orderable area and total up to the parent buy-box. */
  onQuantityChange?: (next: { orderAreaM2: number; total: number }) => void;
  disabled?: boolean;
}) {
  const tileArea = tileAreaFromSize(size);
  const boxArea = parseSqmPerBox(sqmPerBox);
  // £/m² derived from the listed price and its box coverage.
  const pricePerSqm = pricePerSqmFrom(price, sqmPerBox);

  const [areaInput, setAreaInput] = useState<string>("1");
  const [addWastage, setAddWastage] = useState(true);
  // Which field the customer typed in last — the other one follows it.
  const [lastEdited, setLastEdited] = useState<"area" | "tiles">("area");
  const [tilesInput, setTilesInput] = useState<string>(() =>
    tileArea ? String(Math.ceil(1 / tileArea)) : "1",
  );

  const requestedM2 = useMemo(() => {
    if (lastEdited === "tiles" && tileArea) {
      return areaFromTiles(Number(tilesInput) || 0, size) ?? 0;
    }
    return Math.max(0, Number(areaInput) || 0);
  }, [areaInput, tilesInput, lastEdited, tileArea, size]);

  const quote = useMemo(
    () =>
      quoteByArea({
        pricePerSqm,
        size,
        sqmPerBox,
        requestedM2,
        boxPrice: price,
        wastagePercent: addWastage ? DEFAULT_WASTAGE_PERCENT : 0,
      }),
    [pricePerSqm, price, size, sqmPerBox, requestedM2, addWastage],
  );

  // Keep the parent buy-box in step. Depends on the two primitive values
  // rather than the quote object so it only fires when the numbers move.
  const notify = useRef(onQuantityChange);
  notify.current = onQuantityChange;
  useEffect(() => {
    notify.current?.({ orderAreaM2: quote.orderAreaM2, total: quote.total });
  }, [quote.orderAreaM2, quote.total]);

  const handleArea = (value: string) => {
    setLastEdited("area");
    setAreaInput(value);
    if (tileArea) {
      const m2 = Math.max(0, Number(value) || 0);
      setTilesInput(String(Math.ceil(m2 / tileArea)));
    }
  };

  const handleTiles = (value: string) => {
    setLastEdited("tiles");
    setTilesInput(value);
    if (tileArea) {
      const n = Math.max(0, Number(value) || 0);
      setAreaInput(String(Math.round(n * tileArea * 100) / 100));
    }
  };

  return (
    <div className="rounded-xl border border-foreground/10 bg-white p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <span className="text-2xl font-bold">{formatPrice(pricePerSqm)}</span>
          <span className="text-sm text-muted-foreground"> / m²</span>
        </div>
        {quote.pricePerTile != null && (
          <p className="text-xs text-muted-foreground">
            Price per tile: {formatPrice(quote.pricePerTile)}
          </p>
        )}
      </div>

      <div>
        <p className="text-sm font-bold mb-2">Enter a quantity:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="relative block">
            <span className="sr-only">Area in square metres</span>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={areaInput}
              disabled={disabled}
              onChange={(e) => handleArea(e.target.value)}
              className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              m²
            </span>
          </label>

          {tileArea != null && (
            <label className="relative block">
              <span className="sr-only">Number of tiles</span>
              <input
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                value={tilesInput}
                disabled={disabled}
                onChange={(e) => handleTiles(e.target.value)}
                className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                tile{Number(tilesInput) === 1 ? "" : "s"}
              </span>
            </label>
          )}
        </div>

        {tileArea != null && quote.tiles != null && (
          <p className="mt-2 text-xs text-muted-foreground">
            {quote.areaM2}m² will need {quote.tiles} tile
            {quote.tiles === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <label
        className={cn(
          "flex items-start gap-2.5 rounded-lg bg-[#f7f5f2] px-3 py-2.5 cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <input
          type="checkbox"
          checked={addWastage}
          disabled={disabled}
          onChange={(e) => setAddWastage(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-foreground"
        />
        <span className="text-xs leading-relaxed">
          Add {DEFAULT_WASTAGE_PERCENT}% for cuts and wastage
          {boxArea ? " (rounded up to the nearest full box)" : ""}
          <Info className="inline-block w-3 h-3 ml-1 opacity-50 align-text-top" />
        </span>
      </label>

      <div className="flex items-baseline justify-between border-t border-foreground/10 pt-3">
        <span className="text-sm text-muted-foreground">Total:</span>
        <span className="text-xl font-bold">{formatPrice(quote.total)}</span>
      </div>

      {(quote.boxes != null || quote.orderAreaM2 !== quote.areaM2) && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Ordering {quote.orderAreaM2}m²
          {quote.boxes != null
            ? ` — ${quote.boxes} box${quote.boxes === 1 ? "" : "es"} of ${quote.sqmPerBox}m²`
            : ""}
          .
        </p>
      )}
    </div>
  );
}

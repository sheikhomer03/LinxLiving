"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { quoteByArea } from "@/lib/tileCalculator";
import { tradeUnitPrice } from "@/lib/trade";
import {
  lookupZoneByPostcode,
  searchPostcodeAreas,
  type DeliveryZone,
} from "@/lib/deliveryZones";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatArea(value: number) {
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Every Porcious zone carries the same 4 brackets: a fixed "upto20" /
 * "20to35" / "35plus1", then one size-specific top bracket whose key name
 * (e.g. "54plus") encodes its own threshold — read generically so this
 * doesn't need to know which of the 4 tile sizes it's looking at. The zone
 * number itself is a backend pricing detail only — never shown on screen;
 * the customer only ever sees their own postcode area.
 */
function topKeyOf(zoneRates: Record<string, number>) {
  return Object.keys(zoneRates).find(
    (k) => !["upto20", "20to35", "35plus1"].includes(k),
  );
}

function bracketLabel(key: string, topThreshold: number) {
  if (key === "upto20") return "Up to 20m²";
  if (key === "20to35") return "20–35m²";
  if (key === "35plus1") return `35–${topThreshold}m²`;
  return `${topThreshold}m²+`;
}

export function PorciousZoneConfigurator({
  zonePricing,
  sqmPerBox,
  minimumOrderM2,
  minimumOrderBoxes,
  disabled = false,
  onQuantityChange,
  tradeActive = false,
  originalMultiplier = 1,
}: {
  zonePricing: Record<string, Record<string, number>>;
  sqmPerBox?: number | null;
  minimumOrderM2: number;
  minimumOrderBoxes?: number | null;
  disabled?: boolean;
  onQuantityChange?: (
    next: { orderAreaM2: number; total: number; packs?: number; zoneLabel?: string } | null,
  ) => void;
  tradeActive?: boolean;
  originalMultiplier?: number;
}) {
  // Zone (1-4) is purely a backend pricing lookup — never rendered. What the
  // customer sees is their own postcode area (areaLabel). No default: both
  // start unset until an actual postcode is matched, every visit.
  const [zone, setZone] = useState<DeliveryZone | null>(null);
  const [areaLabel, setAreaLabel] = useState("");
  const [zoneQuery, setZoneQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // Rate tier is chosen by picking one of the 4 pills below; the area is a
  // separate, freely-editable field defaulting to the minimum order size.
  const [selectedBracket, setSelectedBracket] = useState<string | null>(null);
  const [areaInput, setAreaInput] = useState(String(minimumOrderM2));
  const boxWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxWrapRef.current && !boxWrapRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function chooseZone(next: DeliveryZone, label: string) {
    setZone(next);
    setAreaLabel(label);
    setShowResults(false);
    setNotFound(false);
    setZoneQuery("");
  }

  function changeZone() {
    setZone(null);
    setAreaLabel("");
  }

  function submitPostcodeSearch() {
    const found = lookupZoneByPostcode(zoneQuery);
    if (found) {
      chooseZone(found, zoneQuery.trim().toUpperCase());
    } else {
      setNotFound(true);
    }
  }

  const searchResults = useMemo(
    () => (zoneQuery.trim() ? searchPostcodeAreas(zoneQuery) : []),
    [zoneQuery],
  );

  const requestedM2 = Math.max(0, Number(areaInput) || 0);
  const belowMinimum = requestedM2 > 0 && requestedM2 < minimumOrderM2;

  const zoneRates = zone ? zonePricing[`zone${zone}`] : undefined;
  const topKey = zoneRates ? topKeyOf(zoneRates) : undefined;
  const topThreshold = topKey ? parseInt(topKey, 10) : 0;
  const bracketKeys = zoneRates
    ? ["upto20", "20to35", "35plus1", topKey || ""].filter(Boolean)
    : [];

  const pricePerSqm =
    zoneRates && selectedBracket ? (zoneRates[selectedBracket] ?? null) : null;

  const quote = useMemo(() => {
    if (!pricePerSqm) return null;
    return quoteByArea({
      pricePerSqm,
      sqmPerBox: sqmPerBox ?? null,
      requestedM2,
      wastagePercent: 0,
      boxPrice: null,
      roundToBox: !!sqmPerBox,
    });
  }, [pricePerSqm, requestedM2, sqmPerBox]);

  const isValid =
    !!zone && !!selectedBracket && !belowMinimum && !!quote && quote.orderAreaM2 > 0;

  const notify = useRef(onQuantityChange);
  useEffect(() => {
    notify.current = onQuantityChange;
  }, [onQuantityChange]);
  useEffect(() => {
    notify.current?.(
      isValid
        ? {
            orderAreaM2: quote!.orderAreaM2,
            total: quote!.total,
            packs: quote!.boxes ?? undefined,
            zoneLabel: areaLabel || undefined,
          }
        : null,
    );
  }, [isValid, quote, areaLabel]);

  return (
    <div className="space-y-3">
      {/* Delivery postcode — required before order size/price unlock below. */}
      <div ref={boxWrapRef} className="relative rounded-xl border border-foreground/45 bg-white px-4 py-4 space-y-3">
        <p className="text-[15px] font-semibold text-foreground">
          Your delivery postcode
        </p>

        {zone ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-foreground/15 bg-[#faf8f3] pl-3 pr-2.5 py-2.5">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} />
              <span className="text-[13px] text-foreground">
                Delivering to <span className="font-semibold">{areaLabel}</span>
              </span>
            </span>
            <button
              type="button"
              onClick={changeZone}
              className="shrink-0 rounded-full border border-foreground/15 bg-white px-3 py-1 text-[11px] font-semibold text-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/35" />
              <input
                type="text"
                inputMode="text"
                autoFocus
                placeholder="Enter your postcode, e.g. SS14 3DR"
                value={zoneQuery}
                disabled={disabled}
                onChange={(e) => {
                  setZoneQuery(e.target.value);
                  setShowResults(true);
                  setNotFound(false);
                }}
                onFocus={() => setShowResults(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitPostcodeSearch();
                  }
                }}
                className="w-full rounded-lg border border-foreground/45 bg-white pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
              />

              {showResults && searchResults.length > 0 ? (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-foreground/15 bg-white shadow-lg overflow-hidden">
                  {searchResults.map(({ area, zone: z }) => (
                    <li key={area}>
                      <button
                        type="button"
                        onClick={() => chooseZone(z, area)}
                        className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-[#faf8f3]"
                      >
                        <span className="font-medium text-foreground">{area}…</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {notFound ? (
              <p className="text-[12px] text-red-600">
                We couldn&rsquo;t match that postcode — try just the letters
                of your postcode area (e.g. &ldquo;SS&rdquo;).
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Order size + price — locked until a postcode is confirmed above. */}
      <div
        className={cn(
          "rounded-xl border bg-white px-4 py-4 space-y-4",
          zone ? "border-foreground/10" : "border-foreground/10 opacity-60",
        )}
      >
        {!zone ? (
          <p className="text-[13px] text-foreground/55">
            Enter your delivery postcode above to see pricing and order size
            options for this product.
          </p>
        ) : (
          <>
            <div>
              <p className="text-[15px] font-semibold text-foreground">
                Choose your order size
              </p>
              <p className="mt-0.5 text-[12px] text-foreground/50">
                Price per m² depends on how much you order
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {bracketKeys.map((key) => {
                const price = zoneRates?.[key];
                const active = key === selectedBracket;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelectedBracket(key)}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                      active
                        ? "border-foreground bg-[#faf8f3]"
                        : "border-foreground/25 hover:border-foreground/45",
                    )}
                  >
                    <span className="block text-[12px] font-semibold text-foreground">
                      {bracketLabel(key, topThreshold)}
                    </span>
                    <span className="block text-[13px] font-bold text-foreground">
                      {price != null
                        ? formatPrice(
                            tradeActive ? tradeUnitPrice(price, true) : price,
                          )
                        : "—"}
                      <span className="text-[11px] font-normal text-foreground/50"> /m²</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div>
              <span className="mb-1.5 block text-[12px] text-foreground/60">
                Enter the area you need
              </span>
              <div className="relative">
                <input
                  type="number"
                  min={minimumOrderM2}
                  step="0.1"
                  inputMode="decimal"
                  value={areaInput}
                  disabled={disabled}
                  onChange={(e) => setAreaInput(e.target.value)}
                  className={cn(
                    "w-full rounded-lg border bg-white px-3 py-3 pr-14 text-lg text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50",
                    belowMinimum
                      ? "border-red-400 focus:ring-red-200"
                      : "border-foreground/45",
                  )}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground/45">
                  m²
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-foreground/50">
                Minimum order {formatArea(minimumOrderM2)} m²
                {minimumOrderBoxes ? ` (${minimumOrderBoxes} boxes)` : ""}
              </p>
              {belowMinimum ? (
                <p className="mt-1 text-[12px] text-red-600">
                  Minimum order for this product is {formatArea(minimumOrderM2)} m²
                  {minimumOrderBoxes ? ` (${minimumOrderBoxes} boxes)` : ""}.
                </p>
              ) : null}
            </div>

            {!selectedBracket ? (
              <p className="text-[12px] text-foreground/55">
                Select an order size above to see your price.
              </p>
            ) : null}

            {quote ? (
              <div className="flex items-center justify-between gap-3 border-t border-foreground/10 pt-3 text-sm text-foreground">
                <div>
                  <p className="text-foreground/60">Your price</p>
                  <p className="font-semibold">
                    {tradeActive ? (
                      <>
                        <span className="mr-1.5 font-normal text-foreground/45 line-through">
                          {formatPrice((pricePerSqm || 0) * originalMultiplier)}
                        </span>
                        {formatPrice(tradeUnitPrice(pricePerSqm || 0, true))}
                      </>
                    ) : (
                      formatPrice(pricePerSqm || 0)
                    )}{" "}
                    / m²
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-foreground/60">
                    {quote.boxes
                      ? `${quote.boxes} box${quote.boxes === 1 ? "" : "es"} · ${formatArea(quote.orderAreaM2)}m²`
                      : `${formatArea(quote.orderAreaM2)}m²`}
                  </p>
                  <p className="font-semibold">
                    {tradeActive ? (
                      <>
                        <span className="mr-1.5 font-normal text-foreground/45 line-through">
                          {formatPrice(quote.total * originalMultiplier)}
                        </span>
                        {formatPrice(tradeUnitPrice(quote.total, true))}
                      </>
                    ) : (
                      formatPrice(quote.total)
                    )}
                  </p>
                </div>
              </div>
            ) : null}

            {sqmPerBox ? (
              <p className="text-[11px] leading-relaxed text-foreground/45">
                Sold in full boxes of {formatArea(sqmPerBox)} m². We
                automatically round your order up to the next full box.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  parseSqmPerBox,
  pricePerSqmFrom,
  quoteByArea,
} from "@/lib/tileCalculator";
import { CONTACT_HREF } from "@/lib/priceOnRequest";
import { tradeUnitPrice } from "@/lib/trade";

const ACCENT = "#8a7355";
const WASTAGE_OPTIONS = [
  { value: 0, label: "No extra" },
  { value: 5, label: "5%" },
  { value: 10, label: "10% recommended" },
  { value: 15, label: "15%" },
];

type Room = { id: string; length: string; width: string; height: string };

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

function newRoom(): Room {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    length: "",
    width: "",
    height: "",
  };
}

function floorAreaM2(length: number, width: number) {
  return Math.max(0, length) * Math.max(0, width);
}

/** Four walls of a rectangular room: 2 × (L + W) × H */
function wallsAreaM2(length: number, width: number, height: number) {
  return 2 * (Math.max(0, length) + Math.max(0, width)) * Math.max(0, height);
}

/**
 * Project quantity calculator for area-sold products (tiles, flooring).
 *
 * - With box coverage: rounds up to full boxes (Spectra-style).
 * - Without box coverage: quotes by m² using the product price as £/m².
 * - Floor / Walls tabs only when the product range supports wall installs.
 */
export function ProductProjectCalculator({
  price,
  size,
  sqmPerBox,
  priceIsPerSqm = false,
  productName,
  brandName,
  allowWalls = false,
  onQuantityChange,
  disabled = false,
  tradeActive = false,
  originalMultiplier = 1,
}: {
  /** Box price when sold by the box; otherwise £/m². */
  price: number;
  size?: string | null;
  sqmPerBox?: string | number | null;
  /** Price is already per m² (pack coverage is informational only). */
  priceIsPerSqm?: boolean;
  productName?: string;
  brandName?: string;
  /** Show Floor/Walls tabs (tiles). Flooring brands stay floor-only. */
  allowWalls?: boolean;
  onQuantityChange?: (next: { orderAreaM2: number; total: number }) => void;
  disabled?: boolean;
  /** Self-serve Trade Mode — the totals shown here reflect the reduction,
      but `onQuantityChange` always reports the true (pre-trade) total, since
      the cart re-applies the discount itself from the account/toggle state. */
  tradeActive?: boolean;
  /** Scales a total up to what it would be at the true pre-sale price, for
      the "Was" figure — 1 when there's no sale on top of trade. */
  originalMultiplier?: number;
}) {
  const boxArea = parseSqmPerBox(sqmPerBox);
  const soldByBox = boxArea != null && boxArea > 0;
  const pricePerSqm = pricePerSqmFrom(price, sqmPerBox, priceIsPerSqm);
  const defaultArea = soldByBox ? boxArea! : 1;

  const [expanded, setExpanded] = useState(false);
  /** Trade standard 10%, on by default — see the tick in simple area mode. */
  const [simpleWastage, setSimpleWastage] = useState(true);
  const [tiling, setTiling] = useState<"floor" | "walls">("floor");
  const [areaInput, setAreaInput] = useState(() => String(defaultArea));
  const [rooms, setRooms] = useState<Room[]>([newRoom()]);
  const [wastage, setWastage] = useState(10);

  useEffect(() => {
    if (!allowWalls && tiling === "walls") setTiling("floor");
  }, [allowWalls, tiling]);

  const roomsArea = useMemo(() => {
    return rooms.reduce((sum, room) => {
      const l = Number(room.length) || 0;
      const w = Number(room.width) || 0;
      const h = Number(room.height) || 0;
      return (
        sum +
        (tiling === "walls" ? wallsAreaM2(l, w, h) : floorAreaM2(l, w))
      );
    }, 0);
  }, [rooms, tiling]);

  const requestedM2 = expanded
    ? roomsArea
    : Math.max(0, Number(areaInput) || 0);

  const quote = useMemo(
    () =>
      quoteByArea({
        pricePerSqm,
        size,
        sqmPerBox: soldByBox ? boxArea : null,
        requestedM2,
        boxPrice: soldByBox ? price : null,
        // Room mode uses the dropdown; simple area mode uses the Wastage
        // allowance tick. Previously simple mode applied none at all, so the
        // same product quoted differently depending on which panel was open.
        wastagePercent: expanded ? wastage : simpleWastage ? 10 : 0,
        roundToBox: soldByBox,
      }),
    [
      pricePerSqm,
      size,
      soldByBox,
      boxArea,
      requestedM2,
      price,
      expanded,
      wastage,
      simpleWastage,
    ],
  );

  const boxes = quote.boxes ?? 0;
  const supplied = quote.orderAreaM2;
  const productLabel = productName || brandName || "this product";

  const notify = useRef(onQuantityChange);
  notify.current = onQuantityChange;
  useEffect(() => {
    notify.current?.({ orderAreaM2: quote.orderAreaM2, total: quote.total });
  }, [quote.orderAreaM2, quote.total]);

  const quoteHref = (() => {
    const params = new URLSearchParams({
      product: productLabel,
      subject: "Quantity quote",
    });
    if (supplied > 0) {
      params.set(
        "message",
        soldByBox && boxes > 0
          ? `I'd like a quote for ${boxes} box${boxes === 1 ? "" : "es"} (${formatArea(supplied)} m²) of ${productLabel}.`
          : `I'd like a quote for ${formatArea(supplied)} m² of ${productLabel}.`,
      );
    }
    return `${CONTACT_HREF}?${params.toString()}`;
  })();

  const title = soldByBox
    ? "Calculate tiles for your project"
    : "Calculate quantity for your project";
  const subtitle = soldByBox
    ? "Enter your room measurements and we'll work out the boxes."
    : "Enter your room measurements and we'll work out the area.";
  const surfaceLabel = allowWalls
    ? "What are you tiling?"
    : "What are you covering?";

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-sm">
        {soldByBox ? (
          <>
            <p className="text-foreground/70">
              <span className="font-semibold text-foreground">
                Price per box{" "}
                {tradeActive ? (
                  <>
                    <span className="line-through text-foreground/45 font-normal">
                      Was {formatPrice(price * originalMultiplier)}
                    </span>{" "}
                    {formatPrice(tradeUnitPrice(price, true))}
                  </>
                ) : (
                  formatPrice(price)
                )}
              </span>
              <span className="text-foreground/40"> · </span>
              1 box covers {formatArea(boxArea!)} m²
            </p>
            <p className="text-foreground/55">
              Equivalent price per m²{" "}
              <span className="font-semibold text-foreground">
                {tradeActive ? (
                  <>
                    <span className="line-through text-foreground/45 font-normal">
                      Was {formatPrice(pricePerSqm * originalMultiplier)}
                    </span>{" "}
                    {formatPrice(tradeUnitPrice(pricePerSqm, true))}
                  </>
                ) : (
                  formatPrice(pricePerSqm)
                )}
              </span>
            </p>
          </>
        ) : (
          <p className="text-foreground/70">
            <span className="font-semibold text-foreground">
              {tradeActive ? (
                <>
                  <span className="line-through text-foreground/45 font-normal">
                    Was {formatPrice(pricePerSqm * originalMultiplier)}
                  </span>{" "}
                  {formatPrice(tradeUnitPrice(pricePerSqm, true))}
                </>
              ) : (
                formatPrice(pricePerSqm)
              )}
            </span>
            <span className="text-foreground/50"> / m² · inc. VAT</span>
          </p>
        )}
      </div>

      {!expanded ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full flex items-start justify-between gap-3 rounded-xl border border-foreground/45 bg-[#faf8f3] px-4 py-3.5 text-left transition-colors hover:border-foreground/25"
          >
            <span>
              <span className="block text-[15px] font-semibold text-foreground">
                {title}
              </span>
              <span className="mt-1 block text-[12px] text-foreground/55">
                {subtitle}
              </span>
            </span>
            <Plus
              className="mt-0.5 h-4 w-4 shrink-0 text-foreground/60"
              strokeWidth={2.5}
            />
          </button>

          <div className="rounded-xl border border-foreground/10 bg-white px-4 py-4 space-y-4">
            <div>
              <p className="text-[15px] font-semibold text-foreground">
                Area required
              </p>
              <p className="mt-0.5 text-[12px] text-foreground/50">
                Enter the amount you need in m²
              </p>
            </div>

            <label className="relative block">
              <span className="sr-only">Area in square metres</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={areaInput}
                disabled={disabled}
                onChange={(e) => setAreaInput(e.target.value)}
                className="w-full rounded-lg border border-foreground/45 bg-white px-3 py-3 pr-14 text-lg text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground/45">
                m²
              </span>
            </label>

            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={simpleWastage}
                disabled={disabled}
                onChange={(e) => setSimpleWastage(e.target.checked)}
                className="h-4 w-4 accent-[#D3102F]"
              />
              <span className="text-[13px] text-foreground/75">
                Wastage allowance{" "}
                <span className="text-foreground/50">
                  (+10% for cuts &amp; breakages)
                </span>
              </span>
            </label>

            <div className="flex items-center justify-between gap-3 border-t border-foreground/10 pt-3 text-sm text-foreground">
              {soldByBox ? (
                <>
                  <p>
                    Your basket:{" "}
                    <span className="font-semibold">
                      {boxes} box{boxes === 1 ? "" : "es"}
                    </span>
                  </p>
                  <p>
                    Total supplied:{" "}
                    <span className="font-semibold">
                      {formatArea(supplied)} m²
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Order area:{" "}
                    <span className="font-semibold">
                      {formatArea(supplied)} m²
                    </span>
                  </p>
                  <p>
                    Total:{" "}
                    {tradeActive ? (
                      <>
                        <span className="line-through text-foreground/45 mr-1.5">
                          Was {formatPrice(quote.total * originalMultiplier)}
                        </span>
                        <span className="font-semibold">
                          {formatPrice(tradeUnitPrice(quote.total, true))}
                        </span>
                      </>
                    ) : (
                      <span className="font-semibold">
                        {formatPrice(quote.total)}
                      </span>
                    )}
                  </p>
                </>
              )}
            </div>

            <p className="text-[11px] leading-relaxed text-foreground/45">
              {soldByBox
                ? `Sold in full boxes of ${formatArea(boxArea!)} m². We automatically round your required area up to the next full box.`
                : "Enter the area you need. Open the project calculator for room measurements and wastage."}
            </p>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-foreground/45 bg-white px-4 py-4 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold text-foreground">
                {title}
              </p>
              <p className="mt-1 text-[12px] text-foreground/55">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-0.5 rounded-md p-1 text-foreground/55 hover:bg-foreground/5 hover:text-foreground"
              aria-label="Collapse project calculator"
            >
              <Minus className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          <div className="h-px bg-foreground/10" />

          {allowWalls ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/60 mb-2">
                {surfaceLabel}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["floor", "walls"] as const).map((opt) => {
                  const selected = tiling === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setTiling(opt)}
                      className={cn(
                        "h-11 rounded-lg text-sm font-semibold capitalize transition-colors",
                        selected
                          ? "bg-foreground text-background"
                          : "border border-foreground/45 text-foreground hover:border-foreground/35 bg-[#faf8f3]",
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {rooms.map((room, index) => (
              <div key={room.id}>
                <div className="flex items-center gap-3 mb-2">
                  <p
                    className="text-sm font-semibold shrink-0"
                    style={{ color: ACCENT }}
                  >
                    Room {index + 1}
                  </p>
                  <div className="h-px flex-1 bg-foreground/10" />
                  {rooms.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRooms((prev) => prev.filter((r) => r.id !== room.id))
                      }
                      className="text-[11px] text-foreground/45 hover:text-foreground"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div
                  className={cn(
                    "grid gap-3",
                    tiling === "walls"
                      ? "grid-cols-1 sm:grid-cols-3"
                      : "grid-cols-2",
                  )}
                >
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] text-foreground/60">
                      Length (m)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      placeholder="e.g. 4.2"
                      value={room.length}
                      disabled={disabled}
                      onChange={(e) =>
                        setRooms((prev) =>
                          prev.map((r) =>
                            r.id === room.id
                              ? { ...r, length: e.target.value }
                              : r,
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-foreground/45 bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] text-foreground/60">
                      Width (m)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      placeholder="e.g. 3.5"
                      value={room.width}
                      disabled={disabled}
                      onChange={(e) =>
                        setRooms((prev) =>
                          prev.map((r) =>
                            r.id === room.id
                              ? { ...r, width: e.target.value }
                              : r,
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-foreground/45 bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
                    />
                  </label>
                  {tiling === "walls" ? (
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] text-foreground/60">
                        Height (m)
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        placeholder="e.g. 2.4"
                        value={room.height}
                        disabled={disabled}
                        onChange={(e) =>
                          setRooms((prev) =>
                            prev.map((r) =>
                              r.id === room.id
                                ? { ...r, height: e.target.value }
                                : r,
                            ),
                          )
                        }
                        className="w-full rounded-lg border border-foreground/45 bg-white px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setRooms((prev) => [...prev, newRoom()])}
              className="text-sm font-medium"
              style={{ color: ACCENT }}
            >
              + Add another room
            </button>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/60 mb-2">
              Extra for cuts and wastage
            </p>
            <select
              value={wastage}
              disabled={disabled}
              onChange={(e) => setWastage(Number(e.target.value))}
              className="w-full rounded-lg border border-foreground/45 bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            >
              {WASTAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div
            className="rounded-lg border border-foreground/10 bg-[#faf8f3] pl-3 pr-3 py-3 space-y-2"
            style={{ borderLeftWidth: 3, borderLeftColor: ACCENT }}
          >
            <div className="flex items-center justify-between gap-3 text-sm text-foreground">
              <span className="text-foreground/60">Area including wastage</span>
              <span className="font-semibold">
                {formatArea(requestedM2 * (1 + wastage / 100))} m²
              </span>
            </div>
            {soldByBox ? (
              <div className="flex items-center justify-between gap-3 text-sm text-foreground">
                <span className="text-foreground/60">Full boxes required</span>
                <span className="font-semibold">
                  {boxes} box{boxes === 1 ? "" : "es"}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 text-sm text-foreground">
                <span className="text-foreground/60">Order total</span>
                {tradeActive ? (
                  <span className="font-semibold text-right">
                    <span className="line-through text-foreground/45 mr-1.5 font-normal">
                      Was {formatPrice(quote.total * originalMultiplier)}
                    </span>
                    {formatPrice(tradeUnitPrice(quote.total, true))}
                  </span>
                ) : (
                  <span className="font-semibold">
                    {formatPrice(quote.total)}
                  </span>
                )}
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-foreground/45 pt-1">
              {soldByBox
                ? `You'll receive ${formatArea(supplied)} m². Every box covers ${formatArea(boxArea!)} m² — always rounded up to a full box.`
                : `Order area ${formatArea(supplied)} m² at ${formatPrice(pricePerSqm)} / m².`}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Link
              href={quoteHref}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-foreground/20 bg-white px-4 text-[12px] font-bold uppercase tracking-wide text-foreground hover:border-foreground/40 transition-colors"
            >
              Get a quote
            </Link>
            <Link
              href={`${CONTACT_HREF}?${new URLSearchParams({
                product: productLabel,
                subject: "WhatsApp quantity enquiry",
                message:
                  supplied > 0
                    ? soldByBox && boxes > 0
                      ? `Hi, I need help with quantities for ${productLabel} (${boxes} boxes / ${formatArea(supplied)} m²).`
                      : `Hi, I need help with quantities for ${productLabel} (${formatArea(supplied)} m²).`
                    : `Hi, I need help with quantities for ${productLabel}.`,
              }).toString()}`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 text-[12px] font-bold uppercase tracking-wide text-white hover:bg-[#1ebe57] transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-current"
                aria-hidden
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

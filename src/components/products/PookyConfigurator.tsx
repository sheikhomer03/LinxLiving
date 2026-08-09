"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ShoppingBag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  hasPookyEfficiency,
  hasPookyOptions,
  type PookyEfficiency,
  type PookyOptionItem,
} from "@/lib/productPookySections";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type PookySelection = {
  baseIndex: number | null;
  shadeIndex: number | null;
  pendantIndex: number | null;
  wallFittingIndex: number | null;
  shadeTab: "shade" | "pendant";
  total: number;
  summary: string;
  base?: PookyOptionItem | null;
  shade?: PookyOptionItem | null;
  pendant?: PookyOptionItem | null;
  wallFitting?: PookyOptionItem | null;
};

const PREVIEW_COUNT = 4;

function OptionGrid({
  items,
  selectedIndex,
  onSelect,
  circular = false,
}: {
  items: { item: PookyOptionItem; index: number }[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  circular?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        circular
          ? "grid-cols-2 sm:grid-cols-4"
          : "grid-cols-2 sm:grid-cols-3",
      )}
    >
      {items.map(({ item, index }) => {
        const selected = selectedIndex === index;
        const img = item.images?.[0] || "";
        return (
          <button
            key={`${item.handle || item.name}-${index}`}
            type="button"
            onClick={() => onSelect(index)}
            className={cn(
              "border p-2 text-left transition-colors",
              selected
                ? "border-[#0d7377] bg-white"
                : "border-foreground/15 bg-[#faf8f3] hover:border-foreground/35",
            )}
            aria-pressed={selected}
          >
            <span
              className={cn(
                "relative block w-full aspect-square bg-white mb-2 overflow-hidden",
                circular && "rounded-full mx-auto max-w-[7.5rem]",
              )}
            >
              {img ? (
                <Image
                  src={img}
                  alt=""
                  fill
                  className="object-contain"
                  sizes="160px"
                  unoptimized
                />
              ) : null}
            </span>
            <span className="block text-xs font-semibold leading-snug line-clamp-2">
              {item.name}
            </span>
            {item.price > 0 ? (
              <span className="block text-xs text-foreground/60 mt-1 tabular-nums">
                {formatPrice(item.price)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function OptionPicker({
  title,
  items,
  selectedIndex,
  onSelect,
  emptyLabel,
  circular = false,
  seeAllNoun,
}: {
  title: string;
  items: PookyOptionItem[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  emptyLabel?: string;
  circular?: boolean;
  /** e.g. "shades with this fitting" — enables see-all when list is long */
  seeAllNoun?: string;
}) {
  const [seeAllOpen, setSeeAllOpen] = useState(false);
  if (!items.length) return null;

  const indexed = items.map((item, index) => ({ item, index }));
  const preview = indexed.slice(0, PREVIEW_COUNT);
  const showSeeAll = Boolean(seeAllNoun) && items.length > PREVIEW_COUNT;

  return (
    <div className="space-y-3">
      {(title || emptyLabel || showSeeAll) && (
        <div className="flex items-center justify-between gap-2">
          {title ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/55">
              {title}
            </p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {emptyLabel ? (
              <button
                type="button"
                onClick={() => onSelect(null)}
                className={cn(
                  "text-[11px] underline underline-offset-2",
                  selectedIndex == null
                    ? "text-foreground font-semibold"
                    : "text-foreground/50",
                )}
              >
                {emptyLabel}
              </button>
            ) : null}
            {showSeeAll ? (
              <button
                type="button"
                onClick={() => setSeeAllOpen(true)}
                className="text-[11px] underline underline-offset-2 text-[#0d7377] font-semibold whitespace-nowrap"
              >
                see all {seeAllNoun}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <OptionGrid
        items={showSeeAll ? preview : indexed}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
        circular={circular}
      />

      {seeAllOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`All ${seeAllNoun || "options"}`}
          onClick={() => setSeeAllOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-3xl max-h-[85vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-foreground/10">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/55">
                  {seeAllNoun || "options"}
                </p>
                <p className="text-sm font-semibold mt-0.5">
                  {items.length} Items
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSeeAllOpen(false)}
                className="p-2 text-foreground/60 hover:text-foreground"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <OptionGrid
                items={indexed}
                selectedIndex={selectedIndex}
                onSelect={(index) => {
                  onSelect(index);
                  setSeeAllOpen(false);
                }}
                circular={circular}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pooky-style configurator: wall fitting + base + shade/pendant tabs.
 */
export function PookyConfigurator({
  bases = [],
  shades = [],
  pendants = [],
  wallFittings = [],
  efficiency,
  productType,
  disabled = false,
  onChange,
  onAddToBasket,
}: {
  bases?: PookyOptionItem[];
  shades?: PookyOptionItem[];
  pendants?: PookyOptionItem[];
  wallFittings?: PookyOptionItem[];
  efficiency?: PookyEfficiency | null;
  productType?: string;
  disabled?: boolean;
  onChange?: (next: PookySelection) => void;
  onAddToBasket?: () => void;
}) {
  const baseList = useMemo(
    () => (bases || []).filter((b) => b?.name),
    [bases],
  );
  const shadeList = useMemo(
    () => (shades || []).filter((s) => s?.name),
    [shades],
  );
  const pendantList = useMemo(
    () => (pendants || []).filter((p) => p?.name),
    [pendants],
  );
  const wallList = useMemo(
    () => (wallFittings || []).filter((w) => w?.name),
    [wallFittings],
  );

  const type = String(productType || "");
  const isBaseProduct = /^base$/i.test(type);
  const isShadeProduct = /lamp\s*shade/i.test(type);
  const isPendantProduct = /pendant\s*shade/i.test(type);
  const isWallProduct = /wall\s*fitting/i.test(type);
  const shadeOptional = isBaseProduct || isWallProduct;

  const [wallFittingIndex, setWallFittingIndex] = useState<number | null>(
    wallList.length ? 0 : null,
  );
  const [baseIndex, setBaseIndex] = useState<number | null>(
    baseList.length ? 0 : null,
  );
  const [shadeTab, setShadeTab] = useState<"shade" | "pendant">(
    shadeList.length ? "shade" : pendantList.length ? "pendant" : "shade",
  );
  // Wall fittings / bases: shade optional (null = none chosen). Shade/pendant
  // products: preselect themselves so the page has a price.
  const [shadeIndex, setShadeIndex] = useState<number | null>(
    isShadeProduct && shadeList.length ? 0 : null,
  );
  const [pendantIndex, setPendantIndex] = useState<number | null>(
    isPendantProduct && pendantList.length ? 0 : null,
  );

  useEffect(() => {
    setWallFittingIndex(wallList.length ? 0 : null);
  }, [wallList.length]);
  useEffect(() => {
    setBaseIndex(baseList.length ? 0 : null);
  }, [baseList.length]);
  useEffect(() => {
    if (shadeList.length && !pendantList.length) setShadeTab("shade");
    else if (!shadeList.length && pendantList.length) setShadeTab("pendant");
  }, [shadeList.length, pendantList.length]);
  useEffect(() => {
    setShadeIndex(isShadeProduct && shadeList.length ? 0 : null);
  }, [shadeList.length, isShadeProduct]);
  useEffect(() => {
    setPendantIndex(isPendantProduct && pendantList.length ? 0 : null);
  }, [pendantList.length, isPendantProduct]);

  const wallFitting =
    wallFittingIndex != null ? wallList[wallFittingIndex] ?? null : null;
  const base = baseIndex != null ? baseList[baseIndex] ?? null : null;
  const shade = shadeIndex != null ? shadeList[shadeIndex] ?? null : null;
  const pendant =
    pendantIndex != null ? pendantList[pendantIndex] ?? null : null;

  const activeShadeOrPendant =
    shadeTab === "pendant" || (!shadeList.length && pendantList.length)
      ? pendant
      : shade;

  // Sum selected hosts + one shade/pendant tab selection (Pooky-style).
  const total =
    (wallFitting?.price || 0) +
    (base?.price || 0) +
    (activeShadeOrPendant?.price || 0);

  const summary = [wallFitting?.name, base?.name, activeShadeOrPendant?.name]
    .filter(Boolean)
    .join(" + ");

  const notify = useRef(onChange);
  notify.current = onChange;
  useEffect(() => {
    notify.current?.({
      baseIndex,
      shadeIndex,
      pendantIndex,
      wallFittingIndex,
      shadeTab,
      total,
      summary,
      base,
      shade,
      pendant,
      wallFitting,
    });
  }, [
    baseIndex,
    shadeIndex,
    pendantIndex,
    wallFittingIndex,
    shadeTab,
    total,
    summary,
    base?.name,
    base?.price,
    shade?.name,
    shade?.price,
    pendant?.name,
    pendant?.price,
    wallFitting?.name,
    wallFitting?.price,
  ]);

  const showWalls = hasPookyOptions(wallList);
  const showBases = hasPookyOptions(baseList);
  const showShades = hasPookyOptions(shadeList);
  const showPendants = hasPookyOptions(pendantList);
  const showShadeTabs = showShades || showPendants;
  const showEff = hasPookyEfficiency(efficiency);

  if (!showWalls && !showBases && !showShadeTabs && !showEff) return null;

  return (
    <div
      className={cn(
        "border border-foreground/15 bg-white p-4 sm:p-5 space-y-6",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      {showWalls ? (
        <OptionPicker
          title="Select your wall fitting"
          items={wallList}
          selectedIndex={wallFittingIndex}
          onSelect={setWallFittingIndex}
        />
      ) : null}

      {showBases ? (
        <OptionPicker
          title="Select your base"
          items={baseList}
          selectedIndex={baseIndex}
          onSelect={setBaseIndex}
          emptyLabel={
            isShadeProduct || isPendantProduct ? "No base, thanks!" : undefined
          }
        />
      ) : null}

      {showShadeTabs ? (
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/55">
            Select your shade or pendant
          </p>
          {showShades && showPendants ? (
            <div className="inline-flex rounded-sm overflow-hidden border border-foreground/15">
              <button
                type="button"
                onClick={() => {
                  setShadeTab("shade");
                  setPendantIndex(null);
                }}
                className={cn(
                  "px-4 py-2 text-xs font-semibold capitalize",
                  shadeTab === "shade"
                    ? "bg-[#0d7377] text-white"
                    : "bg-[#eceae4] text-foreground/70",
                )}
              >
                shade
              </button>
              <button
                type="button"
                onClick={() => {
                  setShadeTab("pendant");
                  setShadeIndex(null);
                }}
                className={cn(
                  "px-4 py-2 text-xs font-semibold capitalize",
                  shadeTab === "pendant"
                    ? "bg-[#0d7377] text-white"
                    : "bg-[#eceae4] text-foreground/70",
                )}
              >
                pendant
              </button>
            </div>
          ) : null}

          {shadeTab === "shade" && showShades ? (
            <OptionPicker
              title=""
              items={shadeList}
              selectedIndex={shadeIndex}
              onSelect={setShadeIndex}
              emptyLabel={shadeOptional ? "No shade, thanks!" : undefined}
              seeAllNoun="shades with this fitting"
            />
          ) : null}

          {(shadeTab === "pendant" || (!showShades && showPendants)) &&
          showPendants ? (
            <OptionPicker
              title={showShades && showPendants ? "" : "Select your pendant"}
              items={pendantList}
              selectedIndex={pendantIndex}
              onSelect={setPendantIndex}
              emptyLabel={shadeOptional ? "No pendant, thanks!" : undefined}
              seeAllNoun="pendants with this fitting"
            />
          ) : null}
        </div>
      ) : null}

      {(showWalls || showBases || showShadeTabs) && (
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-t border-foreground/10 pt-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/55">
              Total
            </p>
            <p className="text-2xl font-bold tabular-nums mt-1">
              {total > 0 ? formatPrice(total) : "—"}
            </p>
            {summary ? (
              <p className="text-xs text-foreground/55 mt-1">{summary}</p>
            ) : (
              <p className="text-xs text-foreground/45 mt-1">
                (no shade/pendant chosen)
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={disabled || total <= 0}
            onClick={() => onAddToBasket?.()}
            className="h-12 px-6 inline-flex items-center justify-center gap-2 bg-[#0d7377] text-white text-[11px] font-bold uppercase tracking-[0.16em] hover:bg-[#0a5c5f] disabled:opacity-40"
          >
            <ShoppingBag className="w-4 h-4" />
            Add to cart
          </button>
        </div>
      )}

      {showEff ? (
        <details className="border-t border-foreground/10 pt-4 group">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.16em]">
            Efficiency
            <span className="text-foreground/40 group-open:rotate-45 text-lg leading-none">
              +
            </span>
          </summary>
          <div className="mt-3 text-sm text-foreground/75 space-y-2">
            {efficiency?.summary ? (
              <p className="font-semibold text-foreground">
                {efficiency.summary}
              </p>
            ) : null}
            {efficiency?.details ? (
              <p className="whitespace-pre-line leading-relaxed">
                {efficiency.details}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

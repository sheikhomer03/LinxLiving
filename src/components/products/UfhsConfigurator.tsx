"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  UfhsCoverage,
  UfhsDoTheJobRight,
  UfhsOptionElement,
  UfhsOptionField,
  UfhsOptionInfo,
  UfhsShopifyOption,
  UfhsVariantRow,
} from "@/lib/productUfhsSections";
import { UfhsGloboOptions } from "@/components/products/UfhsGloboOptions";
import {
  calculateUfhsRoomArea,
  nearestCoverageValue,
  shouldShowMeasureMyRoom,
  type UfhsMeasureResult,
  type UfhsUnheatedArea,
} from "@/lib/ufhsMeasureRoom";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fieldKey(field: UfhsOptionField, prefix = "") {
  return `${prefix}${field.id || field.label}`;
}

function findSelection(
  addonKeys: Record<string, string>,
  fields: UfhsOptionField[],
  labelRe: RegExp,
): string {
  for (const field of fields) {
    if (!labelRe.test(field.label || "")) continue;
    const key = fieldKey(field);
    if (addonKeys[key]) return addonKeys[key];
  }
  return "";
}

function eqLoose(a: string, b: string) {
  return (
    String(a || "")
      .trim()
      .toLowerCase() ===
    String(b || "")
      .trim()
      .toLowerCase()
  );
}

/** Globo often stores the same conditional field several times — keep one. */
function dedupeOptionFields(fields: UfhsOptionField[]): UfhsOptionField[] {
  const seen = new Set<string>();
  const out: UfhsOptionField[] = [];
  for (const field of fields || []) {
    const choiceSig = (field.choices || [])
      .map((c) => `${c.label}|${c.priceAdjustment || 0}`)
      .join("||");
    const key = `${String(field.label || "")
      .trim()
      .toLowerCase()}::${choiceSig}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(field);
  }
  return out;
}

/** Match UFHS Globo show/hide for thermostat / accessory option trees. */
function isFieldVisible(
  field: UfhsOptionField,
  addonKeys: Record<string, string>,
  allFields: UfhsOptionField[],
): boolean {
  const label = String(field.label || "").trim();
  if (!label) return false;

  // Always keep the gate questions + sensor add-ons (UFHS shows Prepare
  // regardless of thermostat Yes/No).
  if (
    /include a thermostat/i.test(label) ||
    /prepare for the future/i.test(label) ||
    /include.*(accessory|kit)/i.test(label)
  ) {
    return true;
  }

  const includeThermo = findSelection(
    addonKeys,
    allFields,
    /include a thermostat/i,
  );
  const thermoTree =
    /thermostat functionality|interface type|thermostat colour|trim colour|^(Smart|Programmable|Basic)-/i.test(
      label,
    );
  // Hide thermostat config until the customer explicitly chooses Yes.
  if (thermoTree && (!includeThermo || /^no\b/i.test(includeThermo))) {
    return false;
  }

  const includeAcc = findSelection(
    addonKeys,
    allFields,
    /include.*(accessory|kit)/i,
  );
  // Accessory Kit dropdowns are Globo conditionals — only after Yes.
  if (/^accessory kit$/i.test(label)) {
    if (!includeAcc || /^no\b/i.test(includeAcc)) return false;
  }

  if (/protect and tidy your air sensor/i.test(label)) {
    const prepare = findSelection(
      addonKeys,
      allFields,
      /prepare for the future/i,
    );
    return /air sensor/i.test(prepare);
  }

  if (/trim colour\s*-\s*black/i.test(label)) {
    const colour = findSelection(addonKeys, allFields, /thermostat colour/i);
    return !colour || /black/i.test(colour);
  }
  if (/trim colour\s*-\s*white/i.test(label)) {
    const colour = findSelection(addonKeys, allFields, /thermostat colour/i);
    return !colour || /white/i.test(colour);
  }

  // Globo product pickers labelled e.g. Smart-black-chrome
  const picker = label.match(
    /^(Smart|Programmable|Basic)-([^-]+)(?:-(.+))?$/i,
  );
  if (picker) {
    const [, func, body, trimPart] = picker;
    const functionality = findSelection(
      addonKeys,
      allFields,
      /thermostat functionality/i,
    );
    const colour = findSelection(addonKeys, allFields, /thermostat colour/i);
    const trimSel = findSelection(addonKeys, allFields, /trim colour/i);

    if (functionality && !eqLoose(functionality, func)) return false;
    if (colour && !eqLoose(colour, body)) return false;
    if (trimPart && trimSel) {
      const want = /matching/i.test(trimSel)
        ? body
        : String(trimSel)
            .replace(/\s*trim$/i, "")
            .trim();
      if (!eqLoose(want, trimPart)) return false;
    }
    return Boolean(functionality && colour);
  }

  return true;
}

function displayFieldLabel(field: UfhsOptionField) {
  const label = String(field.label || "").trim();
  if (/^(Smart|Programmable|Basic)-/i.test(label)) {
    return "Select your thermostat";
  }
  if (/trim colour\s*-/i.test(label)) return "Trim colour";
  return label;
}

const WATTAGE_HELP: Record<string, string> = {
  "100W":
    "Best suited as a primary heat source for new-build properties or a secondary heat source for older properties.",
  "150W":
    "Best-selling option for bathrooms, kitchens and living areas as the primary heating source.",
  "200W":
    "25% faster warm-up — ideal for high heat-loss areas such as conservatories or older properties.",
};

type Props = {
  basePrice: number;
  shopifyOptions?: UfhsShopifyOption[];
  variants?: UfhsVariantRow[];
  coverage?: UfhsCoverage | null;
  nestedOptions?: UfhsOptionField[];
  doTheJobRight?: UfhsDoTheJobRight | null;
  /** Per-axis "more info" copy shown behind the ⓘ, as on the supplier PDP. */
  optionInfo?: UfhsOptionInfo[];
  /** Supplier option builder (swatches, conditional copy, defaults). */
  optionElements?: UfhsOptionElement[];
  hasMeasureMyRoom?: boolean | null;
  productName?: string;
  disabled?: boolean;
  quantity: number;
  maxQuantity?: number;
  onQuantityChange?: (qty: number) => void;
  onConfiguredChange?: (next: {
    unitPrice: number;
    /** Selected variant price, without add-ons. */
    variantPrice?: number | null;
    summary: string;
    variantSku?: string;
  }) => void;
};

/**
 * UFHS-style buy box: Wattage/Coverage dropdowns, Measure My Room,
 * nested Globo options, Do the Job Right tools.
 */
export function UfhsConfigurator({
  basePrice,
  shopifyOptions = [],
  variants = [],
  coverage = null,
  nestedOptions = [],
  doTheJobRight = null,
  optionInfo = [],
  optionElements = [],
  hasMeasureMyRoom = null,
  productName = "",
  disabled = false,
  quantity,
  maxQuantity = 999,
  onQuantityChange,
  onConfiguredChange,
}: Props) {
  const optionAxes = shopifyOptions.filter((o) => o.values?.length);
  const optionFields = useMemo(
    () => dedupeOptionFields(nestedOptions),
    [nestedOptions],
  );
  // No default Wattage / Coverage / Colour — customer must choose.
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [addonKeys, setAddonKeys] = useState<Record<string, string>>({});
  const [toolIndex, setToolIndex] = useState<number | null>(null);
  const hasElements = optionElements.length > 0;
  const [elementState, setElementState] = useState<{
    extraPrice: number;
    summary: string;
  }>({ extraPrice: 0, summary: "" });
  /** Option axis whose ⓘ "more info" panel is open. */
  const [openInfo, setOpenInfo] = useState("");

  const [measureOpen, setMeasureOpen] = useState(false);
  const [roomLength, setRoomLength] = useState("");
  const [roomWidth, setRoomWidth] = useState("");
  const [unheated, setUnheated] = useState<UfhsUnheatedArea[]>([
    { width: "", length: "" },
  ]);
  const [measureError, setMeasureError] = useState("");
  const [measureResult, setMeasureResult] = useState<UfhsMeasureResult | null>(
    null,
  );

  const matchedVariant = useMemo(() => {
    if (!variants.length || !optionAxes.length) return null;
    const allChosen = optionAxes.every((axis) => selected[axis.name]);
    if (!allChosen) return null;
    return (
      variants.find((v) => {
        const vals = [v.option1, v.option2, v.option3].filter(Boolean);
        return optionAxes.every((axis, i) => {
          const want = selected[axis.name];
          return String(vals[i] || "") === want;
        });
      }) || null
    );
  }, [variants, optionAxes, selected]);

  const coverageAxis = optionAxes.find((o) => /coverage/i.test(o.name));
  const coverageValues =
    coverage?.values?.length
      ? coverage.values.map((v) => v.name)
      : coverageAxis?.values || [];

  const showMeasure = shouldShowMeasureMyRoom({
    hasMeasureMyRoom,
    shopifyOptionNames: optionAxes.map((o) => o.name),
    coverageValues,
    productName,
  });

  const addonExtra = useMemo(() => {
    let extra = 0;
    const walk = (fields: UfhsOptionField[], prefix: string) => {
      for (const field of fields) {
        if (!isFieldVisible(field, addonKeys, optionFields)) continue;
        const key = fieldKey(field, prefix);
        const chosen = addonKeys[key];
        if (!chosen) continue;
        const choice = field.choices.find(
          (c) => c.value === chosen || c.label === chosen,
        );
        if (!choice) continue;
        extra += Number(choice.priceAdjustment) || 0;
        if (choice.nested?.length) walk(choice.nested, `${key}::`);
      }
    };
    walk(optionFields, "");
    if (toolIndex != null && doTheJobRight?.items?.[toolIndex]) {
      extra += Number(doTheJobRight.items[toolIndex].priceAdjustment) || 0;
    }
    return extra;
  }, [addonKeys, optionFields, toolIndex, doTheJobRight]);

  const unitPrice =
    (matchedVariant?.price && matchedVariant.price > 0
      ? matchedVariant.price
      : basePrice) + (hasElements ? elementState.extraPrice : addonExtra);

  const summaryParts: string[] = [];
  for (const axis of optionAxes) {
    if (selected[axis.name])
      summaryParts.push(`${axis.name}: ${selected[axis.name]}`);
  }
  if (hasElements) {
    if (elementState.summary) summaryParts.push(elementState.summary);
  } else if (toolIndex != null && doTheJobRight?.items?.[toolIndex]) {
    summaryParts.push(`Tool: ${doTheJobRight.items[toolIndex].name}`);
  }

  useEffect(() => {
    onConfiguredChange?.({
      unitPrice,
      // The headline price follows the chosen variant, as on the supplier
      // PDP; add-ons show in the kit total rather than the headline.
      variantPrice:
        matchedVariant?.price && matchedVariant.price > 0
          ? matchedVariant.price
          : null,
      summary: summaryParts.join(" · "),
      variantSku: matchedVariant?.sku || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitPrice, matchedVariant?.price, matchedVariant?.sku, summaryParts.join("|")]);

  const setAxis = (name: string, value: string) => {
    setSelected((prev) => ({ ...prev, [name]: value }));
  };

  const applyMeasure = () => {
    const calc = calculateUfhsRoomArea(roomLength, roomWidth, unheated);
    if (!calc.ok) {
      setMeasureError(calc.error);
      setMeasureResult(null);
      return;
    }
    setMeasureError("");
    setMeasureResult(calc.result);
    const nearest = nearestCoverageValue(
      coverageValues,
      calc.result.fittedArea,
    );
    if (nearest && coverageAxis) {
      setAxis(coverageAxis.name, nearest);
    } else if (nearest) {
      setAxis("Coverage", nearest);
    }
  };

  const selectClass =
    "w-full rounded-lg border border-foreground/20 bg-white px-3 py-2.5 text-sm font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-foreground/20";

  const renderField = (field: UfhsOptionField, prefix = "") => {
    if (!isFieldVisible(field, addonKeys, optionFields) && !prefix) {
      return null;
    }
    const key = fieldKey(field, prefix);
    const chosen = addonKeys[key] || "";
    const choice = field.choices.find(
      (c) => c.value === chosen || c.label === chosen,
    );
    const type = String(field.type || "").toLowerCase();
    const useImages =
      /image-swatch|color-swatch/i.test(type) ||
      field.choices.some((c) => c.imageUrl);
    const useDropdown =
      /select|dropdown/i.test(type) ||
      (!useImages && field.choices.length > 8);
    const label = displayFieldLabel(field);

    return (
      <div key={key} className="space-y-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {field.helptext ? (
            <p className="text-xs text-foreground/55 mt-0.5">{field.helptext}</p>
          ) : null}
        </div>

        {useDropdown ? (
          <select
            className={selectClass}
            disabled={disabled}
            value={chosen}
            onChange={(e) =>
              setAddonKeys((prev) => ({ ...prev, [key]: e.target.value }))
            }
          >
            <option value="">
              {field.required ? "Select an option" : "None"}
            </option>
            {field.choices.map((c) => (
              <option key={c.value || c.label} value={c.value || c.label}>
                {c.label}
                {c.priceAdjustment
                  ? ` (+${formatPrice(c.priceAdjustment)})`
                  : ""}
              </option>
            ))}
          </select>
        ) : useImages ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {field.choices.map((c) => {
              const active = chosen === c.value || chosen === c.label;
              return (
                <button
                  key={c.value || c.label}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setAddonKeys((prev) => ({
                      ...prev,
                      [key]: c.value || c.label,
                    }))
                  }
                  className={cn(
                    "rounded-lg border p-2 text-left transition-colors",
                    active
                      ? "border-foreground bg-secondary/40"
                      : "border-foreground/15 hover:border-foreground/35",
                  )}
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.imageUrl}
                      alt=""
                      className="w-full aspect-square object-contain rounded-md bg-white mb-2"
                    />
                  ) : null}
                  <p className="text-xs font-medium leading-snug">{c.label}</p>
                  {c.priceAdjustment ? (
                    <p className="text-[11px] text-foreground/50 mt-0.5">
                      +{formatPrice(c.priceAdjustment)}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {field.choices.map((c) => {
              const active = chosen === c.value || chosen === c.label;
              return (
                <button
                  key={c.value || c.label}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setAddonKeys((prev) => ({
                      ...prev,
                      [key]: c.value || c.label,
                    }))
                  }
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/15 hover:border-foreground/35",
                  )}
                >
                  {c.label}
                  {c.priceAdjustment
                    ? ` (+${formatPrice(c.priceAdjustment)})`
                    : ""}
                </button>
              );
            })}
          </div>
        )}

        {choice?.nested?.length
          ? choice.nested.map((n) => renderField(n, `${key}::`))
          : null}
      </div>
    );
  };

  const wattageAxis = optionAxes.find((o) => /wattage/i.test(o.name));
  const wattageHelp =
    wattageAxis && selected[wattageAxis.name]
      ? WATTAGE_HELP[selected[wattageAxis.name]] || ""
      : "";

  /** Scraped "more info" copy for an option axis, shown behind the ⓘ. */
  const infoFor = (name: string) =>
    optionInfo.find((i) => eqLoose(i.name, name))?.text || "";

  return (
    <div
      className={cn(
        // Options sit flush on the page, as they do on the supplier PDP.
        hasElements
          ? "space-y-5"
          : "rounded-xl border border-foreground/10 bg-white p-5 space-y-5",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      {matchedVariant?.badge ? (
        <span className="inline-flex items-center rounded-full bg-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
          {matchedVariant.badge}
        </span>
      ) : null}

      {showMeasure ? (
        <div className="space-y-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMeasureOpen(true)}
            className="inline-flex items-center justify-center rounded-lg border border-foreground/25 bg-secondary/30 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary/50 transition-colors"
          >
            Measure My Room
          </button>
          {measureResult ? (
            <div className="rounded-lg border border-foreground/10 bg-[#fafafa] px-3 py-2 text-xs text-foreground/80 space-y-0.5">
              <div>
                <strong>Area To Be Warmed:</strong> {measureResult.totalAreaLabel}
                m²
              </div>
              <div>
                <strong>Recommended Fitted Size:</strong>{" "}
                {measureResult.fittedAreaLabel}m²
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {optionAxes.map((axis) => {
        const value = selected[axis.name] || "";
        const isWattage = /wattage/i.test(axis.name);
        const isCoverage = /coverage/i.test(axis.name);
        const axisInfo = infoFor(axis.name);
        return (
          <div key={axis.name} className="space-y-2">
            <div>
              <span className="inline-flex items-center gap-1.5">
                <label
                  htmlFor={`ufhs-${axis.name}`}
                  className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/55"
                >
                  {axis.name}
                </label>
                {axisInfo ? (
                  <button
                    type="button"
                    aria-expanded={openInfo === axis.name}
                    aria-label={`More info about ${axis.name}`}
                    className="text-foreground/45 hover:text-foreground transition-colors"
                    onClick={() =>
                      setOpenInfo(openInfo === axis.name ? "" : axis.name)
                    }
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </span>
              {axisInfo && openInfo === axis.name ? (
                <p className="text-xs text-foreground/65 mt-1.5 leading-relaxed whitespace-pre-line rounded-lg border border-foreground/10 bg-[#fafafa] px-3 py-2">
                  {axisInfo}
                </p>
              ) : null}
              {!axisInfo && isWattage && wattageHelp ? (
                <p className="text-xs text-foreground/55 mt-1 leading-relaxed">
                  {wattageHelp}
                </p>
              ) : null}
              {!axisInfo && isCoverage && coverage?.helptext ? (
                <p className="text-xs text-foreground/55 mt-1">
                  {coverage.helptext}
                </p>
              ) : null}
            </div>
            <select
              id={`ufhs-${axis.name}`}
              className={selectClass}
              disabled={disabled}
              value={value}
              onChange={(e) => setAxis(axis.name, e.target.value)}
            >
              <option value="">Select {axis.name}</option>
              {axis.values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        );
      })}

      {/* Coverage-only section when stored separately without shopify axis */}
      {!coverageAxis && coverageValues.length ? (
        <div className="space-y-2">
          <label
            htmlFor="ufhs-coverage-standalone"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/55"
          >
            {coverage?.label || "Coverage"}
          </label>
          <select
            id="ufhs-coverage-standalone"
            className={selectClass}
            disabled={disabled}
            value={selected.Coverage || ""}
            onChange={(e) => setAxis("Coverage", e.target.value)}
          >
            <option value="">Select Coverage</option>
            {coverageValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Supplier option builder — drives the flow, copy and swatches. */}
      {hasElements ? (
        <UfhsGloboOptions
          // Remount (and re-apply defaults) when the option set changes.
          key={optionElements.map((el) => el.id).join("|")}
          elements={optionElements}
          variantTitle={matchedVariant?.name || ""}
          disabled={disabled}
          onChange={setElementState}
        />
      ) : (
        optionFields.map((field) => renderField(field))
      )}

      {!hasElements && doTheJobRight?.items?.length ? (
        <div className="space-y-2 border-t border-foreground/10 pt-4">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {doTheJobRight.label}
            </p>
            {doTheJobRight.helptext ? (
              <p className="text-xs text-foreground/55 mt-1">
                {doTheJobRight.helptext}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {doTheJobRight.items.map((item, index) => {
              const active = toolIndex === index;
              return (
                <button
                  key={`${item.name}-${index}`}
                  type="button"
                  onClick={() =>
                    setToolIndex((prev) => (prev === index ? null : index))
                  }
                  className={cn(
                    "rounded-lg border p-2 text-left transition-colors",
                    active
                      ? "border-foreground bg-secondary/40"
                      : "border-foreground/15 hover:border-foreground/35",
                  )}
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-full aspect-square object-contain rounded-md bg-white mb-2"
                    />
                  ) : null}
                  <p className="text-xs font-medium leading-snug">{item.name}</p>
                  {item.priceAdjustment ? (
                    <p className="text-[11px] text-foreground/50 mt-0.5">
                      +{formatPrice(item.priceAdjustment)}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 border-t border-foreground/10 pt-4">
        <div>
          <p className="text-sm font-semibold">Quantity</p>
          <p className="text-xs text-foreground/50">
            {formatPrice(unitPrice)} each
          </p>
        </div>
        <div className="flex items-center border border-foreground/15 rounded-lg">
          <button
            type="button"
            className="px-3 py-2 text-lg leading-none"
            onClick={() => onQuantityChange?.(Math.max(1, quantity - 1))}
          >
            −
          </button>
          <span className="w-10 text-center text-sm font-semibold tabular-nums">
            {quantity}
          </span>
          <button
            type="button"
            className="px-3 py-2 text-lg leading-none disabled:opacity-40"
            disabled={quantity >= maxQuantity}
            onClick={() =>
              onQuantityChange?.(Math.min(maxQuantity, quantity + 1))
            }
          >
            +
          </button>
        </div>
      </div>

      {measureOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Close room calculator"
            onClick={() => setMeasureOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ufhs-rmc-title"
            className="relative z-[81] w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
          >
            <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-foreground/10 bg-white px-5 py-4">
              <h2 id="ufhs-rmc-title" className="text-lg font-semibold">
                Room Heating Area Calculator
              </h2>
              <button
                type="button"
                className="rounded-full p-1.5 hover:bg-secondary"
                aria-label="Close"
                onClick={() => setMeasureOpen(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-8">
              <section className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr] md:gap-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://cdn.shopify.com/s/files/1/0688/0323/2025/files/cablecal-step-one-image.jpg?v=1678359305"
                  alt=""
                  className="w-full rounded-xl border border-foreground/10 object-cover"
                />
                <div className="space-y-3">
                  <h3 className="font-semibold">
                    Measure the Longest Length Wall and the Longest Width Wall
                  </h3>
                  <p className="text-sm text-foreground/65">
                    Enter the longest length wall and the longest width wall of
                    your room, ignoring any indents or awkward spaces for now.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="space-y-1 text-sm">
                      <span>Longest Length Wall (m)</span>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        inputMode="decimal"
                        className={selectClass}
                        value={roomLength}
                        onChange={(e) => setRoomLength(e.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span>Longest Width Wall (m)</span>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        inputMode="decimal"
                        className={selectClass}
                        value={roomWidth}
                        onChange={(e) => setRoomWidth(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr] md:gap-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://cdn.shopify.com/s/files/1/0688/0323/2025/files/cablecal-step-two-image.jpg?v=1678359305"
                  alt=""
                  className="w-full rounded-xl border border-foreground/10 object-cover"
                />
                <div className="space-y-3">
                  <h3 className="font-semibold">
                    Measuring Unheated Areas and Odd Shaped Rooms
                  </h3>
                  <p className="text-sm text-foreground/65">
                    Split areas you do not want heated into simple rectangles.
                    Leave unused boxes blank.
                  </p>
                  <div className="space-y-3">
                    {unheated.map((row, index) => (
                      <div
                        key={index}
                        className="rounded-lg border border-foreground/10 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">
                            Unheated Area {index + 1}
                          </p>
                          {index > 0 ? (
                            <button
                              type="button"
                              className="text-xs text-foreground/55 hover:text-foreground"
                              onClick={() =>
                                setUnheated((prev) =>
                                  prev.filter((_, i) => i !== index),
                                )
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            placeholder="Width (m)"
                            className={selectClass}
                            value={row.width}
                            onChange={(e) =>
                              setUnheated((prev) =>
                                prev.map((r, i) =>
                                  i === index
                                    ? { ...r, width: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            placeholder="Length (m)"
                            className={selectClass}
                            value={row.length}
                            onChange={(e) =>
                              setUnheated((prev) =>
                                prev.map((r, i) =>
                                  i === index
                                    ? { ...r, length: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-foreground/20 px-3 py-2 text-sm font-medium hover:bg-secondary/40"
                    onClick={() =>
                      setUnheated((prev) => [
                        ...prev,
                        { width: "", length: "" },
                      ])
                    }
                  >
                    Add Another
                  </button>
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr] md:gap-6 border-t border-foreground/10 pt-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://cdn.shopify.com/s/files/1/0688/0323/2025/files/cablecal-step-three-image.jpg?v=1678359305"
                  alt="Calculated heating area"
                  className="w-full rounded-xl border border-foreground/10 object-cover"
                />
                <div className="space-y-3">
                  <h3 className="font-semibold">Calculated Heating Area</h3>
                  <p className="text-sm text-foreground/65">
                    We calculate the total <strong>area to be warmed</strong>{" "}
                    and the <strong>fitted size</strong> we recommend for
                    purchasing your electric underfloor heating (10%{" "}
                    <strong>smaller</strong> than the area you are heating).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={applyMeasure}
                      className="rounded-lg bg-foreground text-background px-4 py-2.5 text-sm font-semibold"
                    >
                      Calculate
                    </button>
                    <button
                      type="button"
                      onClick={() => setMeasureOpen(false)}
                      className="rounded-lg border border-foreground/20 px-4 py-2.5 text-sm font-medium"
                    >
                      Return to Page
                    </button>
                  </div>
                  {measureError ? (
                    <p className="text-sm text-red-600">{measureError}</p>
                  ) : null}
                  {measureResult ? (
                    <div className="rounded-lg border border-foreground/10 bg-[#fafafa] px-3 py-2 text-sm space-y-1">
                      <div>
                        <strong>Area To Be Warmed:</strong>{" "}
                        {measureResult.totalAreaLabel}m²
                      </div>
                      <div>
                        <strong>Recommended Fitted Size:</strong>{" "}
                        {measureResult.fittedAreaLabel}m²
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

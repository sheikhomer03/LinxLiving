"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  UfhsOptionElement,
  UfhsOptionSelection,
} from "@/lib/productUfhsSections";
import {
  SHOPIFY_VARIANT_KEY,
  elementIdSet,
  initialElementSelection,
  isElementVisible,
  selectionPriceExtra,
  selectionSummary,
} from "@/lib/ufhsOptionElements";

/** Supplier accent (`--header-accent-color: 255 53 66`). */
const ACCENT = "#ff3542";

function formatAdjustment(value: number) {
  if (!value) return "";
  return `+£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function OptionLabel({ element }: { element: UfhsOptionElement }) {
  const [openInfo, setOpenInfo] = useState(false);
  if (element.labelHidden || !element.label) return null;
  return (
    <div className="mb-2">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[15px] font-semibold text-foreground">
          {element.label}
        </span>
        {element.required ? (
          <span style={{ color: ACCENT }} aria-hidden="true">
            *
          </span>
        ) : null}
        {element.helptext ? (
          <button
            type="button"
            aria-label={`More info about ${element.label}`}
            aria-expanded={openInfo}
            className="text-foreground/40 hover:text-foreground transition-colors"
            onClick={() => setOpenInfo((v) => !v)}
          >
            <Info className="w-4 h-4" />
          </button>
        ) : null}
      </span>
      {element.helptext && openInfo ? (
        <p className="mt-1 text-sm text-foreground/70 leading-relaxed">
          {element.helptext}
        </p>
      ) : null}
    </div>
  );
}

/** Two-colour swatches split diagonally, as on the supplier PDP. */
function swatchBackground(color1: string, color2: string, twoColor: boolean) {
  const a = color1 || "#ffffff";
  const b = color2 || a;
  return twoColor && b !== a
    ? { backgroundImage: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }
    : { backgroundColor: a };
}

type Props = {
  elements: UfhsOptionElement[];
  /** Selected Shopify variant title — some rules gate on it. */
  variantTitle?: string;
  disabled?: boolean;
  onChange?: (next: {
    selection: UfhsOptionSelection;
    extraPrice: number;
    summary: string;
  }) => void;
};

/**
 * Renders the supplier's option builder: pill buttons, colour and image
 * swatches, dropdowns and the heading / description copy between them, with
 * the same show-hide rules and pre-selected defaults as the live PDP.
 */
export function UfhsGloboOptions({
  elements,
  variantTitle = "",
  disabled = false,
  onChange,
}: Props) {
  const [selection, setSelection] = useState<UfhsOptionSelection>(() =>
    initialElementSelection(elements),
  );

  const knownIds = useMemo(() => elementIdSet(elements), [elements]);

  /** Conditions can also read the chosen Shopify variant (e.g. "100W / 6.0m2"). */
  const scope = useMemo(
    () =>
      variantTitle
        ? { ...selection, [SHOPIFY_VARIANT_KEY]: [variantTitle] }
        : selection,
    [selection, variantTitle],
  );

  const visible = useMemo(
    () => elements.filter((el) => isElementVisible(el, scope, knownIds)),
    [elements, scope, knownIds],
  );

  const extraPrice = useMemo(
    () => selectionPriceExtra(elements, scope),
    [elements, scope],
  );

  useEffect(() => {
    onChange?.({
      selection,
      extraPrice,
      summary: selectionSummary(elements, scope),
    });
    // onChange identity is not stable in callers; selection drives the update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, extraPrice, elements]);

  const toggle = (element: UfhsOptionElement, value: string) => {
    if (disabled) return;
    setSelection((prev) => {
      const current = prev[element.id] || [];
      if (element.multiple) {
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        return { ...prev, [element.id]: next };
      }
      const isSame = current.includes(value);
      if (isSame && element.deselectNotAllowed) return prev;
      return { ...prev, [element.id]: isSame ? [] : [value] };
    });
  };

  const isChosen = (element: UfhsOptionElement, value: string) =>
    (selection[element.id] || []).includes(value);

  const renderElement = (element: UfhsOptionElement) => {
    const type = element.type.toLowerCase();

    if (type === "spacing") return <div className="h-1" />;

    if (type === "paragraph" || type === "html" || type === "modal") {
      if (!element.text) return null;
      return (
        <div
          // Headings here are sentence case on the supplier PDP, so opt out of
          // the site-wide uppercase heading rule.
          className="ufhs-option-copy text-[15px] text-foreground/75 leading-relaxed [&_h4]:text-[15px] [&_h4]:font-semibold [&_h4]:text-foreground [&_h4]:mb-0 [&_h4]:normal-case [&_h4]:tracking-normal [&_p]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: element.text }}
        />
      );
    }

    if (type === "color-swatches") {
      return (
        <div>
          <OptionLabel element={element} />
          <div className="flex flex-wrap gap-3">
            {element.choices.map((choice) => {
              const on = isChosen(element, choice.value);
              return (
                <button
                  key={choice.value}
                  type="button"
                  title={choice.label}
                  aria-label={choice.label}
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggle(element, choice.value)}
                  className="rounded-full p-[3px] transition-colors"
                  style={{ border: `2px solid ${on ? ACCENT : "transparent"}` }}
                >
                  <span
                    className="block h-9 w-9 rounded-full border border-black/15 bg-cover bg-center"
                    style={
                      // "color" swatches show their colour even when the
                      // option also carries a product photo.
                      element.swatchStyle !== "color" && choice.imageUrl
                        ? { backgroundImage: `url(${choice.imageUrl})` }
                        : choice.color1
                          ? swatchBackground(
                              choice.color1,
                              choice.color2,
                              choice.colorType === "two-color",
                            )
                          : { backgroundImage: `url(${choice.imageUrl})` }
                    }
                  />
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (type === "image-swatches") {
      return (
        <div>
          <OptionLabel element={element} />
          <div className="space-y-3">
            {element.choices.map((choice) => {
              const on = isChosen(element, choice.value);
              return (
                <button
                  key={choice.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => toggle(element, choice.value)}
                  className="flex w-full items-center gap-4 text-left"
                >
                  <span
                    className="shrink-0 rounded-full p-[3px]"
                    style={{
                      border: `2px solid ${on ? ACCENT : "transparent"}`,
                    }}
                  >
                    <span className="block h-16 w-16 overflow-hidden rounded-full border border-black/10 bg-white">
                      {choice.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={choice.imageUrl}
                          alt={choice.label}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : null}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] text-foreground">
                      {choice.label}
                      {choice.priceAdjustment ? (
                        <span className="text-foreground">
                          {" "}
                          {formatAdjustment(choice.priceAdjustment)} GBP
                        </span>
                      ) : null}
                    </span>
                    {choice.helptext ? (
                      <span className="block text-sm text-foreground/60">
                        {choice.helptext}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (type === "dropdown" || type === "select") {
      const value = (selection[element.id] || [])[0] || "";
      return (
        <div>
          <OptionLabel element={element} />
          <select
            className="w-full rounded-lg border border-foreground/20 bg-white px-3 py-2.5 text-[15px] text-foreground focus:border-foreground/40 focus:outline-none"
            disabled={disabled}
            value={value}
            onChange={(e) =>
              setSelection((prev) => ({
                ...prev,
                [element.id]: e.target.value ? [e.target.value] : [],
              }))
            }
          >
            <option value="">Please select</option>
            {element.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
                {choice.priceAdjustment
                  ? ` ${formatAdjustment(choice.priceAdjustment)} GBP`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      );
    }

    // buttons / radio / switch → pill row
    return (
      <div>
        <OptionLabel element={element} />
        <div className="flex flex-wrap gap-2.5">
          {element.choices.map((choice) => {
            const on = isChosen(element, choice.value);
            return (
              <button
                key={choice.value}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => toggle(element, choice.value)}
                className={cn(
                  "rounded-full border px-5 py-2.5 text-[15px] transition-colors",
                  on
                    ? "text-white"
                    : "border-foreground/20 bg-white text-foreground hover:border-foreground/40",
                )}
                style={
                  on
                    ? { backgroundColor: ACCENT, borderColor: ACCENT }
                    : undefined
                }
              >
                {choice.label}
                {choice.priceAdjustment
                  ? ` ${formatAdjustment(choice.priceAdjustment)} GBP`
                  : ""}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (!visible.length) return null;

  return (
    <div className="space-y-5">
      {visible.map((element) => (
        <div key={element.id}>{renderElement(element)}</div>
      ))}
    </div>
  );
}

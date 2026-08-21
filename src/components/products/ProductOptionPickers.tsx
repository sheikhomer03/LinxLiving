"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductOptionExtra } from "@/lib/productExtras";

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function FinishOptionCard({
  finish,
  selected,
  onSelect,
}: {
  finish: ProductOptionExtra;
  selected: boolean;
  onSelect: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const extra = Number(finish.priceAdjustment) || 0;
  const showPreview = previewOpen && Boolean(finish.imageUrl);

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setPreviewOpen(true)}
      onMouseLeave={() => setPreviewOpen(false)}
      onFocus={() => setPreviewOpen(true)}
      onBlur={() => setPreviewOpen(false)}
      className={cn(
        "relative rounded-lg text-left transition-all outline-none",
        selected
          ? "ring-[3px] ring-foreground ring-offset-2"
          : "ring-1 ring-foreground/15 hover:ring-foreground/40",
      )}
    >
      {showPreview ? (
        <div
          className="pointer-events-none absolute bottom-[calc(100%+0.65rem)] left-1/2 z-50 w-[min(15rem,70vw)] -translate-x-1/2"
          role="presentation"
          aria-hidden
        >
          <div className="overflow-hidden rounded-sm border-[3px] border-foreground bg-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={finish.imageUrl}
              alt=""
              className="aspect-5/4 w-full object-cover bg-[#f5f5f5]"
            />
            <p className="px-3 py-2.5 text-sm font-bold uppercase tracking-wide text-foreground leading-snug">
              {finish.name}
            </p>
          </div>
          {/* Arrow pointing at the finish tile */}
          <span
            className="absolute left-1/2 top-full -mt-px h-0 w-0 -translate-x-1/2 border-x-[9px] border-t-10 border-x-transparent border-t-foreground"
            aria-hidden
          />
          <span
            className="absolute left-1/2 top-full -mt-1 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-white"
            aria-hidden
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg bg-white">
        <div className="relative aspect-4/3 bg-[#f5f5f5]">
          {finish.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={finish.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-2 text-center text-[10px] font-bold uppercase tracking-wide text-foreground/45">
              {finish.name}
            </div>
          )}
        </div>
        <div className="space-y-0.5 px-2.5 py-2">
          <p className="text-[12px] font-semibold leading-snug text-foreground">
            {finish.name}
            {extra > 0 ? (
              <span className="font-semibold text-foreground">
                {" "}
                (+ {formatPrice(extra)})
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </button>
  );
}

export function ProductFinishPicker({
  finishes,
  selectedIndex,
  onSelect,
}: {
  finishes: ProductOptionExtra[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  if (!finishes.length) return null;

  return (
    <div className="relative z-10 overflow-visible rounded-xl border border-foreground/10 bg-white p-5 space-y-4">
      <h3 className="text-sm font-bold text-foreground">Finish</h3>
      <div className="relative z-10 grid grid-cols-2 gap-3 overflow-visible sm:grid-cols-3">
        {finishes.map((finish, index) => (
          <FinishOptionCard
            key={`${finish.name}-${index}`}
            finish={finish}
            selected={selectedIndex === index}
            onSelect={() => onSelect(index)}
          />
        ))}
      </div>
    </div>
  );
}

export function ProductFlashingPicker({
  flashings,
  selectedIndex,
  onSelect,
}: {
  flashings: ProductOptionExtra[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected =
    selectedIndex == null ? null : (flashings[selectedIndex] ?? null);
  const selectedExtra = Number(selected?.priceAdjustment) || 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!flashings.length) return null;

  return (
    <div className="rounded-xl border border-foreground/10 bg-white p-4 sm:p-5 space-y-3">
      <h3 className="text-sm font-bold text-foreground">Add Flashing</h3>

      <div ref={rootRef} className="relative w-full min-w-0">
        <button
          type="button"
          id="product-flashing"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-12 w-full min-w-0 items-center gap-3 rounded-md border border-foreground/15 bg-white px-3 text-sm text-foreground outline-none focus:border-foreground"
        >
          {selected?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.imageUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded object-cover border border-foreground/10"
            />
          ) : (
            <span className="h-8 w-8 shrink-0 rounded border border-dashed border-foreground/15 bg-[#f5f5f5]" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {selected
              ? `${selected.name}${selectedExtra > 0 ? ` (+ ${formatPrice(selectedExtra)})` : ""}`
              : "No flashing"}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-foreground/50 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open ? (
          <ul
            role="listbox"
            aria-labelledby="product-flashing"
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[min(18rem,50vh)] w-full overflow-y-auto overscroll-contain rounded-md border border-foreground/10 bg-white shadow-md"
          >
            <li role="option" aria-selected={!selected}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-foreground/5",
                  !selected && "bg-foreground/5",
                )}
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
              >
                <span className="h-10 w-10 shrink-0 rounded border border-dashed border-foreground/15 bg-[#f5f5f5]" />
                <span className="min-w-0 flex-1">No flashing</span>
              </button>
            </li>
            {flashings.map((flashing, index) => {
              const extra = Number(flashing.priceAdjustment) || 0;
              const isSelected = selectedIndex === index;
              return (
                <li
                  key={`${flashing.name}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-foreground/5",
                      isSelected && "bg-foreground/5",
                    )}
                    onClick={() => {
                      onSelect(index);
                      setOpen(false);
                    }}
                  >
                    {flashing.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={flashing.imageUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded object-cover border border-foreground/10"
                      />
                    ) : (
                      <span className="h-10 w-10 shrink-0 rounded border border-dashed border-foreground/15 bg-[#f5f5f5]" />
                    )}
                    <span className="min-w-0 flex-1 leading-snug">
                      {flashing.name}
                      {extra > 0 ? (
                        <span className="text-foreground/55">
                          {" "}
                          (+ {formatPrice(extra)})
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function ProductInsulatingSetPicker({
  price,
  checked,
  onCheckedChange,
}: {
  price: number;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-foreground/10 bg-white p-4 sm:p-5 cursor-pointer hover:border-foreground/25 transition-colors">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-foreground">
          Add insulating set
        </span>
        <span className="block text-sm text-foreground/60 mt-0.5">
          + {formatPrice(price)} inc. VAT
        </span>
      </span>
    </label>
  );
}

/**
 * Compact image-swatch picker for a multi-choice, non-priced attribute —
 * e.g. skylight "Roof pitch" (Flat / Low pitched / Pitched — any or all can
 * apply). A dedicated component (not ProductFinishPicker) so its denser,
 * multi-select styling never touches the "Finish" picker every other
 * product with `finishes` renders.
 */
export function RoofPitchPicker({
  options,
  selected,
  onToggle,
  heading = "Roof pitch",
}: {
  options: ProductOptionExtra[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  heading?: string;
}) {
  if (!options.length) return null;

  return (
    <div className="rounded-lg border border-foreground/10 bg-white p-3 space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground/70">
        {heading}
      </h3>
      <div className="grid grid-cols-3 gap-1">
        {options.map((option, index) => {
          const isSelected = selected.has(index);
          return (
            <button
              key={`${option.name}-${index}`}
              type="button"
              onClick={() => onToggle(index)}
              aria-pressed={isSelected}
              className={cn(
                "group relative overflow-hidden rounded-md text-center transition-all duration-150 outline-none",
                isSelected
                  ? "ring-2 ring-foreground"
                  : "ring-1 ring-foreground/12 hover:ring-foreground/35",
              )}
            >
              <div
                className={cn(
                  "flex h-11 items-center justify-center transition-colors",
                  isSelected ? "bg-foreground/5" : "bg-[#fafafa] group-hover:bg-foreground/3",
                )}
              >
                {option.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={option.imageUrl}
                    alt=""
                    className="h-9 w-9 object-contain opacity-85"
                  />
                ) : null}
              </div>
              <p className="px-0.5 pb-1 text-[9px] font-semibold leading-tight text-foreground">
                {option.name}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Independent priced checkboxes — e.g. "Add Structural Glazing Tape (+£21)",
 * "Self-cleaning coating (+£31.50)" — any number of which can be selected at
 * once. Distinct from ProductFlashingPicker (a single-select dropdown for
 * choosing one flashing kit) since these add-ons are each optional and
 * independent of one another.
 */
export function ProductAddonCheckboxList({
  addons,
  selected,
  onToggle,
}: {
  addons: ProductOptionExtra[];
  selected: Set<number>;
  onToggle: (index: number) => void;
}) {
  if (!addons.length) return null;

  return (
    <div className="divide-y divide-foreground/8 rounded-lg border border-foreground/10 bg-white">
      {addons.map((addon, index) => {
        const price = Number(addon.priceAdjustment) || 0;
        const checked = selected.has(index);
        return (
          <label
            key={`${addon.name}-${index}`}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 p-2.5 transition-colors sm:gap-3 sm:p-3",
              checked ? "bg-foreground/3" : "hover:bg-foreground/2",
            )}
          >
            <input
              type="checkbox"
              className="peer sr-only"
              checked={checked}
              onChange={() => onToggle(index)}
            />
            <span
              aria-hidden
              className={cn(
                "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors",
                checked
                  ? "border-foreground bg-foreground"
                  : "border-foreground/25 peer-focus-visible:border-foreground/60",
              )}
            >
              {checked ? (
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  className="h-2.5 w-2.5"
                  aria-hidden
                >
                  <path
                    d="M2.5 6.2 5 8.7l4.5-5"
                    stroke="white"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>

            {addon.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={addon.imageUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded object-cover border border-foreground/10 sm:h-10 sm:w-10"
              />
            ) : null}

            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight text-foreground sm:text-sm">
                {addon.name}
              </span>
              {price > 0 ? (
                <span className="block text-[12px] text-foreground/55 mt-0.5 sm:text-[13px]">
                  + {formatPrice(price)}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

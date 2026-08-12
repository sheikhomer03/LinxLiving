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
              className="aspect-[5/4] w-full object-cover bg-[#f5f5f5]"
            />
            <p className="px-3 py-2.5 text-sm font-bold uppercase tracking-wide text-foreground leading-snug">
              {finish.name}
            </p>
          </div>
          {/* Arrow pointing at the finish tile */}
          <span
            className="absolute left-1/2 top-full -mt-px h-0 w-0 -translate-x-1/2 border-x-[9px] border-t-[10px] border-x-transparent border-t-foreground"
            aria-hidden
          />
          <span
            className="absolute left-1/2 top-full -mt-[4px] h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-white"
            aria-hidden
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg bg-white">
        <div className="relative aspect-[4/3] bg-[#f5f5f5]">
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

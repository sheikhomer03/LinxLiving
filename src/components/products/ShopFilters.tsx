"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type ShopFilterOption = {
  label: string;
  value: string;
  count?: number;
};

type AccordionKey = "size" | "price" | "department" | "brand" | "category";

const PRICE_PRESETS: {
  label: string;
  min?: number;
  max?: number;
}[] = [
  { label: "Under £200", max: 200 },
  { label: "Under £400", max: 400 },
  { label: "Under £600", max: 600 },
  { label: "Under £800", max: 800 },
  { label: "Under £10,000", max: 10000 },
  { label: "Above £10,000", min: 10000 },
];

interface ShopFiltersProps {
  sizes: ShopFilterOption[];
  brands: ShopFilterOption[];
  categories: ShopFilterOption[];
  departments?: ShopFilterOption[];
  activeSizes: string[];
  activeBrands: string[];
  activeCategories: string[];
  activeDepartments?: string[];
  minDraft: string;
  maxDraft: string;
  highestPrice?: number;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
  onApplyPrice: () => void;
  onPricePreset: (min: string, max: string) => void;
  onToggle: (
    key: "size" | "brand" | "category" | "department",
    value: string,
  ) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  className?: string;
  /** Shown when the Brand list is empty (e.g. no brands in selected department). */
  brandEmptyHint?: string;
  /** Shown when the Category list is empty (e.g. pick a brand first). */
  categoryEmptyHint?: string;
}

function FilterAccordion({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-foreground/10">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-[13px] font-semibold tracking-wide text-foreground">
          {title}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-foreground/50 transition-transform duration-300",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-300",
          open ? "max-h-[520px] opacity-100 pb-4" : "max-h-0 opacity-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function CheckboxList({
  options,
  selected,
  onToggle,
  emptyHint,
}: {
  options: ShopFilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
  emptyHint?: string;
}) {
  if (!options.length) {
    return (
      <p className="text-[12px] text-foreground/50 px-1 py-2">
        {emptyHint || "No options"}
      </p>
    );
  }

  return (
    <div className="space-y-2.5 max-h-64 overflow-y-auto custom-scrollbar pr-1">
      {options.map((opt) => {
        const checked = selected.includes(opt.value);
        const count =
          typeof opt.count === "number" ? opt.count : undefined;
        return (
          <label
            key={opt.value}
            className="flex items-center gap-3 cursor-pointer group px-1"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(opt.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "w-[18px] h-[18px] shrink-0 rounded-[3px] border border-foreground/30 flex items-center justify-center transition-colors",
                checked
                  ? "bg-foreground border-foreground"
                  : "bg-white group-hover:border-foreground/50",
              )}
              aria-hidden
            >
              {checked ? (
                <svg
                  viewBox="0 0 12 12"
                  className="w-2.5 h-2.5 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M2 6.5 L4.5 9 L10 3" />
                </svg>
              ) : null}
            </span>
            <span className="text-[13px] tracking-wide text-foreground/85 group-hover:text-foreground">
              {opt.label}
              {count !== undefined ? (
                <span className="text-foreground/45"> ({count})</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function ShopFilters({
  sizes,
  brands,
  categories,
  departments = [],
  activeSizes,
  activeBrands,
  activeCategories,
  activeDepartments = [],
  minDraft,
  maxDraft,
  highestPrice = 0,
  onMinChange,
  onMaxChange,
  onApplyPrice,
  onPricePreset,
  onToggle,
  onClear,
  hasActiveFilters,
  className,
  brandEmptyHint,
  categoryEmptyHint,
}: ShopFiltersProps) {
  const [openSections, setOpenSections] = useState<
    Record<AccordionKey, boolean>
  >({
    size: false,
    price: false,
    department: activeDepartments.length > 0,
    brand: activeBrands.length > 0,
    category: activeCategories.length > 0,
  });

  useEffect(() => {
    setOpenSections((prev) => ({
      ...prev,
      department: prev.department || activeDepartments.length > 0,
      // Cascade: picking a department surfaces brands; picking a brand surfaces categories.
      brand: prev.brand || activeBrands.length > 0 || activeDepartments.length > 0,
      category: prev.category || activeCategories.length > 0 || activeBrands.length > 0,
    }));
  }, [
    activeDepartments.length,
    activeBrands.length,
    activeCategories.length,
  ]);

  const toggleSection = (key: AccordionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isPresetActive = (min?: number, max?: number) => {
    const activeMin = minDraft || "";
    const activeMax = maxDraft || "";
    const presetMin = min != null ? String(min) : "";
    const presetMax = max != null ? String(max) : "";
    return activeMin === presetMin && activeMax === presetMax;
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-[15px] font-semibold tracking-wide">Filter</h2>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[12px] text-foreground/60 hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            Clear all
          </button>
        ) : (
          <span className="text-[12px] text-transparent select-none">
            Clear all
          </span>
        )}
      </div>

      <FilterAccordion
        title="Size"
        open={openSections.size}
        onToggle={() => toggleSection("size")}
      >
        <CheckboxList
          options={sizes}
          selected={activeSizes}
          onToggle={(v) => onToggle("size", v)}
        />
      </FilterAccordion>

      <FilterAccordion
        title="Price"
        open={openSections.price}
        onToggle={() => toggleSection("price")}
      >
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-foreground/45">
                £
              </span>
              <input
                type="number"
                min={0}
                placeholder="Min"
                value={minDraft}
                onChange={(e) => onMinChange(e.target.value)}
                onBlur={onApplyPrice}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onApplyPrice();
                }}
                className="w-full rounded-md border border-foreground/20 bg-white pl-6 pr-2 py-2 text-[12px] outline-none focus:border-foreground/40"
                aria-label="Minimum price"
              />
            </div>
            <span className="text-[12px] text-foreground/50 shrink-0">to</span>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-foreground/45">
                £
              </span>
              <input
                type="number"
                min={0}
                placeholder="Max"
                value={maxDraft}
                onChange={(e) => onMaxChange(e.target.value)}
                onBlur={onApplyPrice}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onApplyPrice();
                }}
                className="w-full rounded-md border border-foreground/20 bg-white pl-6 pr-2 py-2 text-[12px] outline-none focus:border-foreground/40"
                aria-label="Maximum price"
              />
            </div>
          </div>

          {highestPrice > 0 ? (
            <p className="text-[12px] text-foreground/50 tracking-wide">
              The highest price is £
              {Math.round(highestPrice).toLocaleString("en-GB")}
            </p>
          ) : null}

          <ul className="space-y-1.5 pt-1">
            {PRICE_PRESETS.map((preset) => {
              const active = isPresetActive(preset.min, preset.max);
              return (
                <li key={preset.label}>
                  <button
                    type="button"
                    onClick={() =>
                      onPricePreset(
                        preset.min != null ? String(preset.min) : "",
                        preset.max != null ? String(preset.max) : "",
                      )
                    }
                    className={cn(
                      "text-[13px] tracking-wide transition-colors text-left",
                      active
                        ? "text-foreground font-semibold underline underline-offset-2"
                        : "text-foreground/75 hover:text-foreground hover:underline underline-offset-2",
                    )}
                  >
                    {preset.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </FilterAccordion>

      {departments.length > 0 ? (
        <FilterAccordion
          title="Department"
          open={openSections.department}
          onToggle={() => toggleSection("department")}
        >
          <CheckboxList
            options={departments}
            selected={activeDepartments}
            onToggle={(v) => onToggle("department", v)}
          />
        </FilterAccordion>
      ) : null}

      <FilterAccordion
        title="Brand"
        open={openSections.brand}
        onToggle={() => toggleSection("brand")}
      >
        <CheckboxList
          options={brands}
          selected={activeBrands}
          onToggle={(v) => onToggle("brand", v)}
          emptyHint={brandEmptyHint}
        />
      </FilterAccordion>

      <FilterAccordion
        title="Category"
        open={openSections.category}
        onToggle={() => toggleSection("category")}
      >
        <CheckboxList
          options={categories}
          selected={activeCategories}
          onToggle={(v) => onToggle("category", v)}
          emptyHint={categoryEmptyHint}
        />
      </FilterAccordion>
    </div>
  );
}

export const SORT_OPTIONS = [
  { label: "Newest", value: "newest" },
  { label: "Alphabetically, A-Z", value: "name-asc" },
  { label: "Alphabetically, Z-A", value: "name-desc" },
  { label: "Price: Low to High", value: "price-asc" },
  { label: "Price: High to Low", value: "price-desc" },
] as const;

"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeaturePackingEntry = {
  label: string;
  value: string;
};

function DropdownSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-foreground/15">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-base font-semibold text-foreground">{title}</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-foreground/60 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? <div className="pb-5">{children}</div> : null}
    </div>
  );
}

function KvGrid({ entries }: { entries: FeaturePackingEntry[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-3">
      {entries.map((row) => (
        <div key={`${row.label}-${row.value}`} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/55">
            {row.label}
          </dt>
          <dd className="mt-0.5 text-sm text-foreground break-words">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Porcelanosa Product Finder–style dropdowns:
 * Features, Packing, Legal disclaimer.
 * Files and Documentation is a separate component (not Downloads).
 * https://productfinder.porcelanosagrupo.com/en/
 */
export function ProductFeaturePacking({
  features = [],
  packing = [],
  legalDisclaimer = "",
  className,
}: {
  features?: FeaturePackingEntry[];
  packing?: FeaturePackingEntry[];
  legalDisclaimer?: string | null;
  className?: string;
}) {
  const featureRows = (features || []).filter(
    (r) => String(r.label || "").trim() && String(r.value || "").trim(),
  );
  const packingRows = (packing || []).filter(
    (r) => String(r.label || "").trim() && String(r.value || "").trim(),
  );
  const legal = String(legalDisclaimer || "").trim();

  if (!featureRows.length && !packingRows.length && !legal) {
    return null;
  }

  return (
    <div className={cn("mt-2 border-b border-foreground/15", className)}>
      {featureRows.length ? (
        <DropdownSection title="Features">
          <KvGrid entries={featureRows} />
        </DropdownSection>
      ) : null}

      {packingRows.length ? (
        <DropdownSection title="Packing">
          <KvGrid entries={packingRows} />
        </DropdownSection>
      ) : null}

      {legal ? (
        <DropdownSection title="Legal disclaimer">
          <p className="text-sm text-foreground/70 leading-relaxed">{legal}</p>
        </DropdownSection>
      ) : null}
    </div>
  );
}

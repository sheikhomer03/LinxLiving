"use client";

import { useState } from "react";
import {
  DISCLOSURE_HEADER_CLASS,
  DISCLOSURE_ROW_CLASS,
  DISCLOSURE_TITLE_CLASS,
  DisclosureIcon,
} from "@/components/products/ProductDisclosure";
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
    <div className={DISCLOSURE_ROW_CLASS}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(DISCLOSURE_HEADER_CLASS, DISCLOSURE_TITLE_CLASS)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <DisclosureIcon open={open} />
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
          <dd className="mt-0.5 text-sm text-foreground wrap-break-word">
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

"use client";

import {
  DISCLOSURE_HEADER_CLASS,
  DISCLOSURE_TITLE_CLASS,
  DisclosureIconDetails,
} from "@/components/products/ProductDisclosure";
import { cn } from "@/lib/utils";

export type SupplierSectionRow = { label: string; value: string };

export type SupplierSection = {
  heading: string;
  text?: string;
  rows?: SupplierSectionRow[];
};

export type SupplierInfoDropdown = {
  name: string;
  text?: string;
  items?: { term: string; text: string }[];
};

/**
 * Supplier PDP accordions (Materials & Care, Delivery & Returns …) rendered
 * under the buy box, in the supplier's own order.
 *
 * Copy is rendered as text, never as injected supplier markup: their blocks
 * carry wrappers the browser re-parses differently from the server, which
 * showed up as a hydration mismatch.
 */
export function ProductSupplierSections({
  sections = [],
  infoDropdowns = [],
  className,
}: {
  sections?: SupplierSection[];
  infoDropdowns?: SupplierInfoDropdown[];
  className?: string;
}) {
  const items = (sections || []).filter(
    (s) => s?.heading && ((s.rows || []).length > 0 || String(s.text || "").trim()),
  );
  const notes = (infoDropdowns || []).filter(
    (d) => d?.name && ((d.items || []).length > 0 || String(d.text || "").trim()),
  );
  if (!items.length && !notes.length) return null;

  return (
    <div className={cn("border-b border-black/10 [&>*]:border-t [&>*]:border-black/10", className)}>
      {notes.map((note) => (
        <details key={note.name} className="group py-1">
          <summary className={cn("cursor-pointer list-none", DISCLOSURE_HEADER_CLASS, DISCLOSURE_TITLE_CLASS)}>
            {note.name}
            <DisclosureIconDetails />
          </summary>
          <div className="pb-4 text-sm leading-relaxed text-foreground/75">
            {(note.items || []).length ? (
              (note.items || []).map((row, i) => (
                <p key={i} className="mb-1 last:mb-0">
                  <span className="font-semibold text-foreground">
                    {row.term}:
                  </span>{" "}
                  {row.text}
                </p>
              ))
            ) : (
              <p>{note.text}</p>
            )}
          </div>
        </details>
      ))}

      {items.map((section) => (
        <details key={section.heading} className="group py-1">
          <summary className={cn("cursor-pointer list-none", DISCLOSURE_HEADER_CLASS, DISCLOSURE_TITLE_CLASS)}>
            {section.heading}
            <DisclosureIconDetails />
          </summary>
          <div className="pb-4 text-sm leading-relaxed text-foreground/75">
            {(section.rows || []).length ? (
              <dl className="space-y-0">
                {(section.rows || []).map((row, i) => (
                  <div
                    key={`${row.label}-${i}`}
                    className="flex gap-3 border-b border-foreground/5 py-1.5 last:border-0"
                  >
                    <dt className="w-40 shrink-0 font-semibold text-foreground/70">
                      {row.label}
                    </dt>
                    <dd className="min-w-0">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              String(section.text || "")
                .split("\n")
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i} className="mb-2 last:mb-0">
                    {para}
                  </p>
                ))
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

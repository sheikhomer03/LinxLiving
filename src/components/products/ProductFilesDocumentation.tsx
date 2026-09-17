"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import {
  DISCLOSURE_HEADER_CLASS,
  DISCLOSURE_ROW_CLASS,
  DISCLOSURE_TITLE_CLASS,
  DisclosureIcon,
} from "@/components/products/ProductDisclosure";

import { cn } from "@/lib/utils";
import type { FilesDocumentationSection } from "@/lib/productFilesDocumentation";

/**
 * Porcelanosa-style Files and Documentation accordion.
 * Separate from Noken-style Downloads.
 */
export function ProductFilesDocumentation({
  sections = [],
  className,
  defaultOpen = false,
}: {
  sections?: FilesDocumentationSection[];
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const fileSections = (sections || []).filter(
    (s) =>
      String(s.heading || "").trim() &&
      Array.isArray(s.files) &&
      s.files.some(
        (f) => String(f.title || "").trim() && String(f.url || "").trim(),
      ),
  );
  if (!fileSections.length) return null;

  return (
    <div className={cn(DISCLOSURE_ROW_CLASS, className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(DISCLOSURE_HEADER_CLASS, DISCLOSURE_TITLE_CLASS)}
        aria-expanded={open}
      >
        <span>Files and Documentation</span>
        <DisclosureIcon open={open} />
      </button>
      {open ? (
        <div className="pb-5 space-y-5">
          {fileSections.map((section) => (
            <div key={section.heading}>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/55 mb-2">
                {section.heading}
              </h4>
              <ul className="space-y-2">
                {section.files
                  .filter(
                    (f) =>
                      String(f.title || "").trim() &&
                      String(f.url || "").trim(),
                  )
                  .map((file) => (
                    <li key={`${file.title}-${file.url}`}>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center justify-between gap-3 text-sm text-foreground hover:opacity-70"
                      >
                        <span>
                          {file.title}
                          {!/\((PDF|ZIP)\)/i.test(file.title)
                            ? file.type === "pdf"
                              ? " (PDF)"
                              : file.type === "zip"
                                ? " (ZIP)"
                                : ""
                            : ""}
                        </span>
                        <Download className="w-4 h-4 shrink-0 text-foreground/45 group-hover:text-foreground" />
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

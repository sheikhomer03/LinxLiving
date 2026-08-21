"use client";

import { useState } from "react";
import { ChevronDown, Download } from "lucide-react";
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
    <div className={cn("border-t border-b border-foreground/15", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-base font-semibold text-foreground">
          Files and Documentation
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-foreground/60 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
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

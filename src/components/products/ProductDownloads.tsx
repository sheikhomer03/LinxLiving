"use client";

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductDownloadItem } from "@/lib/productDownloads";

function DownloadTile({ item }: { item: ProductDownloadItem }) {
  const [open, setOpen] = useState(false);
  const hasChildren = item.children.length > 0;
  const href = item.url || item.children[0]?.url || "";

  if (hasChildren) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex flex-col items-center gap-2 p-3 rounded-xl border border-foreground/10 hover:border-foreground/25 hover:bg-secondary/40 transition-colors text-center"
          aria-expanded={open}
        >
          <DownloadIcon item={item} />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/80 flex items-center gap-1">
            {item.title}
            <ChevronDown
              className={cn(
                "w-3 h-3 transition-transform",
                open && "rotate-180",
              )}
            />
          </span>
        </button>
        {open ? (
          <ul className="mt-1 rounded-lg border border-foreground/10 bg-white shadow-sm overflow-hidden">
            {item.children.map((child) => (
              <li key={`${child.title}-${child.url}`}>
                <a
                  href={child.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 text-xs text-foreground/80 hover:bg-secondary transition-colors"
                >
                  {child.title}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center gap-2 p-3 rounded-xl border border-foreground/10 hover:border-foreground/25 hover:bg-secondary/40 transition-colors text-center"
    >
      <DownloadIcon item={item} />
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/80">
        {item.title}
      </span>
    </a>
  );
}

function DownloadIcon({ item }: { item: ProductDownloadItem }) {
  if (item.iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.iconUrl}
        alt=""
        className="w-12 h-12 object-contain"
      />
    );
  }
  return (
    <span className="w-12 h-12 rounded-full bg-[#0041D1] text-white inline-flex items-center justify-center">
      <FileText className="w-5 h-5" />
    </span>
  );
}

/**
 * Noken-style Downloads accordion on the PDP.
 * https://www.noken.com/en/products/
 */
export function ProductDownloads({
  downloads = [],
  className,
  defaultOpen = false,
}: {
  downloads?: ProductDownloadItem[];
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const items = (downloads || []).filter(
    (d) =>
      String(d.title || "").trim() &&
      (String(d.url || "").trim() || (d.children || []).length > 0),
  );
  if (!items.length) return null;

  return (
    <div className={cn("border-t border-b border-foreground/15", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-base font-semibold text-foreground">
          Downloads
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-foreground/60 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="pb-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((item, i) => (
            <DownloadTile key={`${item.title}-${item.url}-${i}`} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

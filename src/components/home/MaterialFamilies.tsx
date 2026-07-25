"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

export type MaterialFamily = {
  name: string;
  tagline: string;
  href: string;
  image: string;
  /** Parent category name — shown as a badge on subcategory cards */
  parentName?: string;
};

interface MaterialFamiliesProps {
  items?: MaterialFamily[];
  eyebrow?: string;
  title?: string;
  description?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  sectionId?: string;
  /** Alternate background for stacked sections */
  tone?: "muted" | "plain";
}

function useGridColumns() {
  const [cols, setCols] = useState(3);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setCols(mq.matches ? 3 : 2);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return cols;
}

export function MaterialFamilies({
  items = [],
  eyebrow = "Collections",
  title = "Shop by subcategory",
  description = "Browse every subcategory in our catalogue — each card shows which parent category it belongs to.",
  viewAllHref = "/new-arrivals",
  viewAllLabel = "View all products",
  sectionId = "collections",
  tone = "muted",
}: MaterialFamiliesProps) {
  const cols = useGridColumns();
  const initialCount = cols; // 1 row
  const loadStep = cols * 2; // next 2 rows
  const [visibleCount, setVisibleCount] = useState(initialCount);

  useEffect(() => {
    setVisibleCount((prev) => {
      // Keep at least one row; if user already loaded more, don't shrink below what they've opened
      // unless we're still on the first page
      if (prev <= initialCount) return initialCount;
      return Math.min(Math.max(prev, initialCount), items.length);
    });
  }, [initialCount, items.length]);

  if (!items.length) return null;

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;
  const canShowLess = visibleCount > initialCount;

  const handleLoadMore = () => {
    setVisibleCount((prev) => Math.min(prev + loadStep, items.length));
  };

  const handleShowLess = () => {
    setVisibleCount((prev) => Math.max(prev - loadStep, initialCount));
  };

  return (
    <section
      className={`px-6 lg:px-20 py-16 md:py-24 ${
        tone === "muted" ? "bg-secondary/40" : "bg-background"
      }`}
      id={sectionId}
    >
      <div className="max-w-[1400px] mx-auto space-y-10 md:space-y-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <p className="uppercase tracking-[0.2em] text-[10px] font-bold text-primary">
              {eyebrow}
            </p>
            <h2 className="text-2xl md:text-3xl font-serif tracking-[0.05em]">
              {title}
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {description}
            </p>
          </div>
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-bold border-b border-foreground/20 pb-1 hover:border-primary hover:text-primary transition-colors self-start shrink-0"
          >
            {viewAllLabel}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5">
          {visibleItems.map((item) => (
            <Link
              key={`${item.parentName || "root"}-${item.href}-${item.name}`}
              href={item.href}
              className="group relative overflow-hidden aspect-[4/3] bg-secondary"
            >
              {item.image ? (
                <Image
                  src={item.image}
                  alt={item.name}
                  fill
                  className="object-contain p-2 md:p-3 transition-transform duration-700 group-hover:scale-[1.03]"
                  sizes="(max-width: 1024px) 50vw, 33vw"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent transition-colors duration-500 group-hover:from-black/90 pointer-events-none" />

              {item.parentName ? (
                <span className="absolute top-3 left-3 z-10 max-w-[85%] truncate px-2.5 py-1 bg-white/95 text-foreground text-[8px] md:text-[9px] uppercase tracking-[0.18em] font-bold shadow-sm">
                  {item.parentName}
                </span>
              ) : null}

              <div className="absolute inset-x-0 bottom-0 p-4 md:p-7 text-white space-y-1.5">
                <h3 className="font-serif text-base md:text-xl tracking-[0.1em] uppercase">
                  {item.name}
                </h3>
                <p className="hidden md:block text-xs text-white/70 tracking-wide">
                  {item.tagline}
                </p>
                <span className="inline-flex items-center gap-2 pt-1 text-[9px] md:text-[10px] uppercase tracking-[0.25em] font-bold text-primary md:opacity-0 md:translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                  Shop now
                  <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleShowLess}
            disabled={!canShowLess}
            className="inline-flex items-center gap-3 px-6 py-2.5 border border-foreground/15 text-[10px] uppercase tracking-[0.18em] font-bold hover:border-primary hover:text-primary transition-colors disabled:opacity-35 disabled:pointer-events-none disabled:hover:border-foreground/15 disabled:hover:text-inherit"
          >
            Less view
          </button>
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={!hasMore}
            className="inline-flex items-center gap-3 px-6 py-2.5 border border-foreground/15 text-[10px] uppercase tracking-[0.18em] font-bold hover:border-primary hover:text-primary transition-colors disabled:opacity-35 disabled:pointer-events-none disabled:hover:border-foreground/15 disabled:hover:text-inherit"
          >
            Load more
          </button>
        </div>
      </div>
    </section>
  );
}

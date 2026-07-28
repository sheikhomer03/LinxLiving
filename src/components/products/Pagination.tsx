"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
}

/** Build a compact page list: 1 … 4 5 [6] 7 8 … 75 */
function getPageItems(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const items: (number | "ellipsis")[] = [];
  const windowStart = Math.max(2, current - 1);
  const windowEnd = Math.min(total - 1, current + 1);

  items.push(1);

  if (windowStart > 2) items.push("ellipsis");

  for (let p = windowStart; p <= windowEnd; p++) {
    items.push(p);
  }

  if (windowEnd < total - 1) items.push("ellipsis");

  items.push(total);
  return items;
}

export function Pagination({ currentPage, totalPages }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", page.toString());
    router.push(`?${params.toString()}`, { scroll: false });
    window.scrollTo({ top: 300, behavior: "smooth" });
  };

  const pages = getPageItems(currentPage, totalPages);

  return (
    <div className="flex flex-wrap justify-center items-center gap-4 sm:gap-8 py-12 sm:py-20 border-t border-foreground/5">
      <button
        type="button"
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="group flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        Previous
      </button>

      <div className="flex items-center gap-2 sm:gap-3">
        <span className="sr-only">
          Page {currentPage} of {totalPages}
        </span>
        {pages.map((item, idx) => {
          if (item === "ellipsis") {
            return (
              <span
                key={`e-${idx}`}
                className="px-1 text-[11px] font-bold tracking-widest opacity-40 select-none"
                aria-hidden
              >
                …
              </span>
            );
          }

          const isActive = item === currentPage;
          return (
            <button
              key={item}
              type="button"
              onClick={() => handlePageChange(item)}
              aria-current={isActive ? "page" : undefined}
              className={`min-w-[1.75rem] text-[11px] font-bold tracking-widest transition-all ${
                isActive
                  ? "text-primary scale-110 underline underline-offset-4"
                  : "opacity-60 hover:opacity-100 hover:text-primary"
              }`}
            >
              {item.toString().padStart(2, "0")}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="group flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        Next
        <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  );
}

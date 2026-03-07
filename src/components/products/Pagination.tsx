"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
}

export function Pagination({ currentPage, totalPages }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", page.toString());
    router.push(`?${params.toString()}`);
    // Scroll to top of results
    window.scrollTo({ top: 300, behavior: "smooth" });
  };

  return (
    <div className="flex justify-center items-center gap-8 py-20 border-t border-foreground/5">
      <button
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="group flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold disabled:opacity-90 disabled:cursor-not-allowed transition-opacity"
      >
        <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        Previous
      </button>

      <div className="flex items-center gap-6">
        {[...Array(totalPages)].map((_, i) => {
          const page = i + 1;
          const isActive = page === currentPage;
          return (
            <button
              key={page}
              onClick={() => handlePageChange(page)}
              className={`text-[11px] font-bold tracking-widest transition-all ${
                isActive
                  ? "opacity-800 scale-110"
                  : "opacity-90 hover:opacity-800"
              }`}
            >
              {page.toString().padStart(2, "0")}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="group flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold disabled:opacity-90 disabled:cursor-not-allowed transition-opacity"
      >
        Next
        <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  );
}

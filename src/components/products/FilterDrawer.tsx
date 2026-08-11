"use client";

import React, { useState, useEffect } from "react";
import { X, SlidersHorizontal, ChevronDown, Check } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

interface FilterDrawerProps {
  categories: string[];
}

export function FilterDrawer({ categories }: FilterDrawerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);

  // Local state for filters
  const [selectedCategory, setSelectedCategory] = useState(
    searchParams.get("category") || "all",
  );
  const [priceRange, setPriceRange] = useState({
    min: searchParams.get("minPrice") || "",
    max: searchParams.get("maxPrice") || "",
  });
  const [sortBy, setSortBy] = useState(searchParams.get("sort") || "newest");

  // Update local state when searchParams change (handling browser back/forward)
  useEffect(() => {
    setSelectedCategory(searchParams.get("category") || "all");
    setPriceRange({
      min: searchParams.get("minPrice") || "",
      max: searchParams.get("maxPrice") || "",
    });
    setSortBy(searchParams.get("sort") || "newest");
  }, [searchParams]);

  const applyFilters = () => {
    const params = new URLSearchParams(searchParams.toString());

    if (selectedCategory && selectedCategory !== "all") {
      params.set("category", selectedCategory);
    } else {
      params.delete("category");
    }

    if (priceRange.min) {
      params.set("minPrice", priceRange.min);
    } else {
      params.delete("minPrice");
    }

    if (priceRange.max) {
      params.set("maxPrice", priceRange.max);
    } else {
      params.delete("maxPrice");
    }

    if (sortBy) {
      params.set("sort", sortBy);
    } else {
      params.delete("sort");
    }

    // Reset to page 1 when filtering
    params.delete("page");

    router.push(`/tiles?${params.toString()}`, { scroll: false });
    setIsOpen(false);
  };

  const clearFilters = () => {
    setSelectedCategory("all");
    setPriceRange({ min: "", max: "" });
    setSortBy("newest");
    router.push("/tiles", { scroll: false });
    setIsOpen(false);
  };

  return (
    <>
      <div className="flex justify-between items-center mb-12 py-4 border-b border-foreground/5">
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold hover:opacity-90 transition-opacity"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filter & Sort
        </button>
        <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80">
          Showing{" "}
          {selectedCategory === "all"
            ? "All"
            : selectedCategory.replace(/-/g, " ")}{" "}
          Pieces
        </p>
      </div>

      {/* Drawer Overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/40 backdrop-blur-sm z-100 transition-opacity duration-500",
          isOpen ? "opacity-800" : "opacity-0 pointer-events-none",
        )}
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer Content */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-full max-w-sm bg-white z-101 shadow-2xl transition-transform duration-500 ease-in-out p-10 flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex justify-between items-center mb-12">
          <h2 className="text-xl font-serif uppercase tracking-widest">
            Filters
          </h2>
          <button onClick={() => setIsOpen(false)}>
            <X className="w-6 h-6 opacity-80 hover:opacity-800 transition-opacity" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-12 pr-4 custom-scrollbar">
          {/* Categories */}
          <div className="space-y-6">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
              Category
            </h3>
            <div className="flex flex-wrap gap-2">
              {["all", ...categories].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-4 py-2 text-[10px] uppercase tracking-widest border transition-all",
                    selectedCategory === cat
                      ? "bg-foreground text-background border-foreground"
                      : "border-foreground/10 hover:border-foreground/40",
                  )}
                >
                  {cat.replace(/-/g, " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Price Range */}
          <div className="space-y-6">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
              Price Range (£)
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="number"
                placeholder="Min"
                value={priceRange.min}
                onChange={(e) =>
                  setPriceRange((prev) => ({ ...prev, min: e.target.value }))
                }
                className="w-full bg-secondary/30 px-4 py-3 text-[10px] uppercase tracking-widest outline-none border border-foreground/45 hover:border-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
              <input
                type="number"
                placeholder="Max"
                value={priceRange.max}
                onChange={(e) =>
                  setPriceRange((prev) => ({ ...prev, max: e.target.value }))
                }
                className="w-full bg-secondary/30 px-4 py-3 text-[10px] uppercase tracking-widest outline-none border border-foreground/45 hover:border-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>

          {/* Sort By */}
          <div className="space-y-6">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
              Sort By
            </h3>
            <div className="space-y-2">
              {[
                { label: "Newest Arrivals", value: "newest" },
                { label: "Price: Low to High", value: "price-asc" },
                { label: "Price: High to Low", value: "price-desc" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSortBy(option.value)}
                  className="w-full flex justify-between items-center py-2 text-[10px] uppercase tracking-widest hover:opacity-90 transition-opacity"
                >
                  {option.label}
                  {sortBy === option.value && (
                    <Check className="w-3 h-3 text-green-600" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-10 flex flex-col gap-4 border-t border-foreground/5 mt-auto">
          <button
            onClick={applyFilters}
            className="w-full bg-[#333] text-white py-5 text-[10px] uppercase tracking-[0.3em] font-bold hover:bg-black transition-colors"
          >
            Show Results
          </button>
          <button
            onClick={clearFilters}
            className="w-full border border-[#333]/10 py-5 text-[10px] uppercase tracking-[0.3em] font-bold hover:bg-secondary transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>
    </>
  );
}

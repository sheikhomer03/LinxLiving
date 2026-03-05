"use client";

import { X, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getPublicCollections } from "@/app/actions/collections";

interface FilterSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FilterSidebar({ isOpen, onClose }: FilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") || "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") || "");
  const [sort, setSort] = useState(searchParams.get("sort") || "newest");
  const [selectedCategory, setSelectedCategory] = useState(
    searchParams.get("category") || "",
  );
  const [collections, setCollections] = useState<any[]>([]);

  useEffect(() => {
    getPublicCollections().then(setCollections);
  }, []);

  const coreCategories = [
    { name: "Baths", slug: "baths" },
    { name: "Vanity Units", slug: "vanity-units" },
    { name: "Basins", slug: "basins" },
    { name: "Mirrors", slug: "mirrors" },
    { name: "Accessories", slug: "accessories" },
    { name: "Tiles", slug: "tiles" },
  ];

  const allCategoryOptions = [
    ...coreCategories,
    ...collections.map((c) => ({ name: c.name, slug: c.slug })),
  ];

  const handleApplyFilters = () => {
    const params = new URLSearchParams(searchParams.toString());

    if (minPrice) params.set("minPrice", minPrice);
    else params.delete("minPrice");

    if (maxPrice) params.set("maxPrice", maxPrice);
    else params.delete("maxPrice");

    if (sort) params.set("sort", sort);
    else params.delete("sort");

    if (selectedCategory) params.set("category", selectedCategory);
    else params.delete("category");

    // Reset to page 1 when applying filters
    params.set("page", "1");

    // If we are on a category-specific page, applying a filter might redirect or just update params
    // But since collections ARE categories, maybe we should just update the URL params
    router.push(`?${params.toString()}`);
    onClose();
  };

  const handleClearFilters = () => {
    setMinPrice("");
    setMaxPrice("");
    setSort("newest");
    setSelectedCategory("");
    router.push(window.location.pathname);
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed top-0 right-0 h-full w-[350px] bg-white z-50 shadow-2xl transition-transform duration-500 ease-in-out p-10 flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex justify-between items-center mb-12">
          <h2 className="text-sm font-bold uppercase tracking-[0.3em]">
            Filter Models
          </h2>
          <button
            onClick={onClose}
            className="hover:rotate-90 transition-transform duration-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 space-y-12">
          {/* Sorting */}
          <div className="space-y-6">
            <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-40">
              Sort By
            </h3>
            <div className="space-y-4">
              {[
                { label: "Newest Releases", value: "newest" },
                { label: "Price: Low to High", value: "price-asc" },
                { label: "Price: High to Low", value: "price-desc" },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-3 cursor-pointer group"
                >
                  <input
                    type="radio"
                    name="sort"
                    value={option.value}
                    checked={sort === option.value}
                    onChange={(e) => setSort(e.target.value)}
                    className="hidden"
                  />
                  <div
                    className={`w-3 h-3 rounded-full border border-foreground/20 flex items-center justify-center transition-colors ${sort === option.value ? "border-foreground bg-foreground" : "group-hover:border-foreground"}`}
                  >
                    {sort === option.value && (
                      <div className="w-1 h-1 bg-white rounded-full" />
                    )}
                  </div>
                  <span
                    className={`text-[11px] uppercase tracking-widest transition-opacity ${sort === option.value ? "opacity-100" : "opacity-60 group-hover:opacity-100"}`}
                  >
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-6">
            <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-40">
              Category / Collection
            </h3>
            <div className="space-y-2">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full input-standard bg-secondary/30 border-none py-3 px-4 text-[11px] outline-none focus:ring-1 focus:ring-foreground/10 transition-all font-sans uppercase tracking-widest"
              >
                <option value="">All Categories</option>
                <optgroup label="Core Categories">
                  {coreCategories.map((cat) => (
                    <option key={cat.slug} value={cat.slug}>
                      {cat.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Collections">
                  {collections.map((coll) => (
                    <option key={coll.slug} value={coll.slug}>
                      {coll.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Price Range */}
          <div className="space-y-6">
            <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-40">
              Price Range
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-widest opacity-40">
                  Min (£)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  className="w-full input-standard bg-secondary/30 border-none py-3 px-4 text-[11px] outline-none focus:ring-1 focus:ring-foreground/10 transition-all font-sans"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-widest opacity-40">
                  Max (£)
                </label>
                <input
                  type="number"
                  placeholder="5000"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="w-full input-standard bg-secondary/30 border-none py-3 px-4 text-[11px] outline-none focus:ring-1 focus:ring-foreground/10 transition-all font-sans"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-10 flex flex-col gap-4">
          <button
            onClick={handleApplyFilters}
            className="w-full bg-foreground text-background py-5 text-[10px] font-bold uppercase tracking-[0.3em] hover:bg-accent hover:text-foreground transition-colors duration-300"
          >
            Apply Filters
          </button>
          <button
            onClick={handleClearFilters}
            className="w-full py-5 text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 hover:opacity-100 transition-opacity"
          >
            Clear All
          </button>
        </div>
      </div>
    </>
  );
}

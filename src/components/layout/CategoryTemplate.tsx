"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { ShopFilters, SORT_OPTIONS } from "@/components/products/ShopFilters";
import { ChevronDown, Folder, LayoutGrid, List, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/products/Pagination";
import {
  getCatalogFacetCounts,
  getPublicProducts,
} from "@/app/actions/products";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Suspense } from "react";
import { getProductDisplayImage } from "@/lib/productImage";
import { cn } from "@/lib/utils";

const SIZE_OPTIONS = [
  { label: "600 × 600", value: "600x600" },
  { label: "600 × 900", value: "600x900" },
  { label: "600 × 1200", value: "600x1200" },
];

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

interface CategoryPageProps {
  title: string;
  description: string;
  slug: string;
  /** Full catalogue browse (no forced category slug) */
  browseAll?: boolean;
  initialProducts?: {
    products: any[];
    total: number;
    totalPages: number;
    page: number;
  };
  initialBrandMenus?: any[];
  initialStoreName?: string;
  initialFacetCounts?: {
    sizeCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
    brandCounts: Record<string, number>;
    maxPrice?: number;
  };
}

function CategoryPageContent({
  title,
  description,
  slug,
  browseAll = false,
  initialProducts,
  initialBrandMenus,
  initialStoreName,
  initialFacetCounts,
}: CategoryPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [minDraft, setMinDraft] = useState(searchParams.get("minPrice") || "");
  const [maxDraft, setMaxDraft] = useState(searchParams.get("maxPrice") || "");
  const [facetCounts, setFacetCounts] = useState(
    initialFacetCounts || {
      sizeCounts: {} as Record<string, number>,
      categoryCounts: {} as Record<string, number>,
      brandCounts: {} as Record<string, number>,
      maxPrice: 0,
    },
  );
  const [data, setData] = useState<{
    products: any[];
    total: number;
    totalPages: number;
    page: number;
  }>(
    initialProducts || {
      products: [],
      total: 0,
      totalPages: 0,
      page: 1,
    },
  );
  const [isLoading, setIsLoading] = useState(!initialProducts);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("catalogue-view");
      if (saved === "list" || saved === "grid") setViewMode(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const changeViewMode = (mode: "grid" | "list") => {
    setViewMode(mode);
    try {
      window.sessionStorage.setItem("catalogue-view", mode);
    } catch {
      /* ignore */
    }
  };

  const brandSlugToCategories = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const brand of initialBrandMenus || []) {
      const slugs: string[] = [];
      for (const menu of brand.menus || []) {
        slugs.push(menu.slug, menu.name);
        for (const child of menu.children || []) {
          slugs.push(child.slug, child.name);
        }
      }
      map[brand.slug] = [...new Set(slugs.filter(Boolean))];
    }
    return map;
  }, [initialBrandMenus]);

  const categoryOptionsBase = useMemo(() => {
    const map = new Map<string, string>();
    for (const brand of initialBrandMenus || []) {
      for (const menu of brand.menus || []) {
        if (!menu.parent) {
          map.set(menu.slug, menu.name);
        }
      }
    }
    if (map.size === 0) {
      return [
        { label: "Gloss", value: "gloss" },
        { label: "High Gloss", value: "high-gloss" },
        { label: "Matt", value: "matt" },
        { label: "Matt Carving", value: "matt-carving" },
        { label: "Outdoor", value: "outdoor" },
      ];
    }
    return [...map.entries()].map(([value, label]) => ({ label, value }));
  }, [initialBrandMenus]);

  const sizeOptions = useMemo(
    () =>
      SIZE_OPTIONS.map((opt) => ({
        ...opt,
        count: facetCounts.sizeCounts[opt.value] ?? 0,
      })),
    [facetCounts.sizeCounts],
  );

  const brandOptions = useMemo(
    () =>
      (initialBrandMenus || []).map((b: any) => ({
        label: b.name,
        value: b.slug,
        count: facetCounts.brandCounts[b.slug] ?? 0,
      })),
    [initialBrandMenus, facetCounts.brandCounts],
  );

  const categoryOptions = useMemo(
    () =>
      categoryOptionsBase.map((opt) => ({
        ...opt,
        count: facetCounts.categoryCounts[opt.value] ?? 0,
      })),
    [categoryOptionsBase, facetCounts.categoryCounts],
  );

  const activeSizes = parseList(searchParams.get("size"));
  const activeBrands = parseList(searchParams.get("brand"));
  const activeCategories = parseList(
    searchParams.get("category") || searchParams.get("finish"),
  );
  const activeSort = searchParams.get("sort") || "newest";
  const activeMin = searchParams.get("minPrice") || "";
  const activeMax = searchParams.get("maxPrice") || "";

  useEffect(() => {
    setMinDraft(activeMin);
    setMaxDraft(activeMax);
  }, [activeMin, activeMax]);

  useEffect(() => {
    if (initialFacetCounts) return;

    const loadFacets = async () => {
      const brands = (initialBrandMenus || []).map((b: any) => ({
        slug: b.slug,
        name: b.name,
        categorySlugs: brandSlugToCategories[b.slug] || [],
      }));
      const counts = await getCatalogFacetCounts({
        brands,
        categories: categoryOptionsBase,
      });
      setFacetCounts(counts);
    };

    loadFacets();
  }, [
    initialFacetCounts,
    initialBrandMenus,
    brandSlugToCategories,
    categoryOptionsBase,
  ]);

  const setListParam = (key: string, values: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (values.length) params.set(key, values.join(","));
    else params.delete(key);
    // Drop legacy finish param when updating category
    if (key === "category") params.delete("finish");
    params.set("page", "1");
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const applyPrice = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (minDraft) params.set("minPrice", minDraft);
    else params.delete("minPrice");
    if (maxDraft) params.set("maxPrice", maxDraft);
    else params.delete("maxPrice");
    params.set("page", "1");
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const applyPricePreset = (min: string, max: string) => {
    setMinDraft(min);
    setMaxDraft(max);
    const params = new URLSearchParams(searchParams.toString());
    if (min) params.set("minPrice", min);
    else params.delete("minPrice");
    if (max) params.set("maxPrice", max);
    else params.delete("maxPrice");
    params.set("page", "1");
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const setSort = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "newest") params.set("sort", value);
    else params.delete("sort");
    params.set("page", "1");
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const clearFilters = () => {
    router.push(pathname, { scroll: false });
  };

  const hasActiveFilters = Boolean(
    activeSizes.length ||
      activeBrands.length ||
      activeCategories.length ||
      activeMin ||
      activeMax ||
      (activeSort && activeSort !== "newest"),
  );

  useEffect(() => {
    const page = searchParams.get("page")
      ? Number(searchParams.get("page"))
      : 1;
    const sort = searchParams.get("sort") || "newest";
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const search = searchParams.get("search") || undefined;
    const sizes = parseList(searchParams.get("size"));
    const brands = parseList(searchParams.get("brand"));
    const categories = parseList(
      searchParams.get("category") || searchParams.get("finish"),
    );

    const resolvedCategory =
      categories.length > 0
        ? categories
        : browseAll || slug === "all"
          ? undefined
          : slug;

    const brandCategorySlugs =
      brands.length > 0
        ? [
            ...new Set(
              brands.flatMap((b) => brandSlugToCategories[b] || []),
            ),
          ]
        : undefined;

    const isDefaultView =
      sizes.length === 0 &&
      brands.length === 0 &&
      categories.length === 0 &&
      !minPrice &&
      !maxPrice &&
      !search &&
      (!searchParams.get("sort") || sort === "newest") &&
      page === 1 &&
      (browseAll || slug === "all");

    if (isDefaultView && initialProducts) {
      setData(initialProducts);
      setIsLoading(false);
      return;
    }

    const fetchProducts = async () => {
      setIsLoading(true);
      const result = await getPublicProducts({
        category: resolvedCategory,
        size: sizes.length ? sizes : undefined,
        brand: brands.length ? brands : undefined,
        brandCategorySlugs,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        sort,
        search,
        page,
        limit: 12,
        fields: "name price images category stock shopifyVariantId specs",
      });
      setData(result);
      setIsLoading(false);
    };

    fetchProducts();
  }, [slug, browseAll, searchParams, initialProducts, brandSlugToCategories]);

  const breadcrumbHref =
    browseAll || slug === "all" ? "/category" : `/category/${slug}`;

  const filtersPanel = (
    <ShopFilters
      sizes={sizeOptions}
      brands={brandOptions}
      categories={categoryOptions}
      activeSizes={activeSizes}
      activeBrands={activeBrands}
      activeCategories={activeCategories}
      minDraft={minDraft}
      maxDraft={maxDraft}
      highestPrice={facetCounts.maxPrice || 0}
      onMinChange={setMinDraft}
      onMaxChange={setMaxDraft}
      onApplyPrice={applyPrice}
      onPricePreset={applyPricePreset}
      onToggle={(key, value) => {
        if (key === "size") setListParam("size", toggleValue(activeSizes, value));
        else if (key === "brand")
          setListParam("brand", toggleValue(activeBrands, value));
        else
          setListParam(
            "category",
            toggleValue(activeCategories, value),
          );
      }}
      onClear={clearFilters}
      hasActiveFilters={hasActiveFilters}
    />
  );

  return (
    <main className="min-h-screen">
      <Navbar
        initialBrandMenus={initialBrandMenus}
        initialStoreName={initialStoreName}
      />
      <PageHeader
        title={title}
        description={description}
        breadcrumb={[{ label: title, href: breadcrumbHref }]}
      />

      <section className="md:py-8 px-6 lg:px-12 xl:px-20">
        <div className="max-w-8xl mx-auto">
          {/* Toolbar — Hide filters + results + sort */}
          <div className="flex flex-wrap items-center gap-4 mb-8 py-4 border-b border-foreground/10">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined" && window.innerWidth < 1024) {
                  setMobileFiltersOpen(true);
                } else {
                  setFiltersVisible((v) => !v);
                }
              }}
              className="inline-flex items-center gap-2 rounded-full border border-foreground/20 px-4 py-2 text-[12px] font-medium tracking-wide hover:border-foreground/40 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="lg:hidden">Filters</span>
              <span className="hidden lg:inline">
                {filtersVisible ? "Hide filters" : "Show filters"}
              </span>
            </button>
            <p className="text-[13px] text-foreground/70 tracking-wide">
              {data.total.toLocaleString("en-GB")} Results
            </p>

            <div className="ml-auto flex items-center gap-3 sm:gap-4">
              <div className="flex items-center border border-foreground/15 rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => changeViewMode("grid")}
                  aria-label="Grid view"
                  aria-pressed={viewMode === "grid"}
                  className={cn(
                    "p-2 transition-colors",
                    viewMode === "grid"
                      ? "bg-foreground text-background"
                      : "bg-white text-foreground/60 hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => changeViewMode("list")}
                  aria-label="List view"
                  aria-pressed={viewMode === "list"}
                  className={cn(
                    "p-2 transition-colors border-l border-foreground/15",
                    viewMode === "list"
                      ? "bg-foreground text-background"
                      : "bg-white text-foreground/60 hover:text-foreground",
                  )}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="catalogue-sort"
                  className="text-[13px] text-foreground/70 tracking-wide hidden sm:inline"
                >
                  Sort:
                </label>
                <div className="relative">
                  <select
                    id="catalogue-sort"
                    value={activeSort}
                    onChange={(e) => setSort(e.target.value)}
                    className="appearance-none rounded-md border border-foreground/15 bg-white pl-3 pr-8 py-2 text-[13px] tracking-wide text-foreground outline-none cursor-pointer hover:border-foreground/30 focus:border-foreground/40"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/50" />
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "grid gap-10 xl:gap-14",
              filtersVisible ? "lg:grid-cols-12" : "lg:grid-cols-1",
            )}
          >
            {/* Desktop filters */}
            {filtersVisible && (
              <aside className="hidden lg:block lg:col-span-3 xl:col-span-3">
                <div className="sticky top-28 pb-10">{filtersPanel}</div>
              </aside>
            )}

            {/* Product grid */}
            <div
              className={cn(
                filtersVisible ? "lg:col-span-9 xl:col-span-9" : "lg:col-span-1",
              )}
            >
              {isLoading ? (
                <div
                  className={cn(
                    "opacity-90 animate-pulse mb-16",
                    viewMode === "list"
                      ? "flex flex-col gap-4"
                      : cn(
                          "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-6",
                          filtersVisible ? "xl:grid-cols-3" : "xl:grid-cols-4",
                        ),
                  )}
                >
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={i}
                      className={
                        viewMode === "list"
                          ? "h-36 bg-secondary"
                          : "aspect-square bg-secondary"
                      }
                    />
                  ))}
                </div>
              ) : data.products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-6 opacity-90">
                  <Folder className="w-16 h-16 stroke-1" />
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-serif tracking-widest uppercase">
                      No products found
                    </h3>
                    <p className="text-[10px] uppercase tracking-widest">
                      Try adjusting your filters
                    </p>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="mt-4 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold hover:text-primary"
                      >
                        <X className="w-3.5 h-3.5" /> Clear all
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={cn(
                      "mb-16",
                      viewMode === "list"
                        ? "flex flex-col gap-3 sm:gap-4"
                        : cn(
                            "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-8",
                            filtersVisible ? "xl:grid-cols-3" : "xl:grid-cols-4",
                          ),
                    )}
                    data-view={viewMode}
                  >
                    {data.products.map((product) => (
                      <ProductCard
                        key={`${product._id}-${viewMode}`}
                        id={product._id}
                        name={product.name}
                        price={product.price}
                        category={product.category}
                        image={getProductDisplayImage(product.images)}
                        stock={product.stock}
                        shopifyVariantId={product.shopifyVariantId}
                        layout={viewMode}
                      />
                    ))}
                  </div>

                  <Pagination
                    currentPage={data.page}
                    totalPages={data.totalPages}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Mobile filter drawer */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="absolute top-0 right-0 h-full w-[min(100%,360px)] bg-white shadow-2xl p-6 overflow-y-auto">
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="p-2"
                aria-label="Close filters"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {filtersPanel}
          </div>
        </div>
      )}

      <Footer initialStoreName={initialStoreName} />
    </main>
  );
}

export default function CategoryPage(props: CategoryPageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex flex-col">
          <Navbar
            initialBrandMenus={props.initialBrandMenus}
            initialStoreName={props.initialStoreName}
          />
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
              Curating architectural elements...
            </div>
          </div>
          <Footer initialStoreName={props.initialStoreName} />
        </div>
      }
    >
      <CategoryPageContent {...props} />
    </Suspense>
  );
}

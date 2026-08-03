"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { ShopFilters, SORT_OPTIONS } from "@/components/products/ShopFilters";
import {
  ShopByTiles,
  type CatalogueTile,
} from "@/components/products/ShopBySubcategory";
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
import { getCategoryDescription } from "@/lib/categoryDescriptions";
import { LINX_DEPARTMENTS } from "@/lib/catalogueTaxonomy";
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
  initialDepartments?: any[];
  initialStoreName?: string;
  initialFacetCounts?: {
    sizeCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
    subcategoryCounts?: Record<string, number>;
    subcategoryScopedCounts?: Record<string, number>;
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
  initialDepartments,
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
      subcategoryCounts: {} as Record<string, number>,
      subcategoryScopedCounts: {} as Record<string, number>,
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

  const searchKey = searchParams.toString();

  const activeSizes = useMemo(
    () => parseList(searchParams.get("size")),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by searchKey
    [searchKey],
  );
  const activeBrands = useMemo(
    () => parseList(searchParams.get("brand")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchKey],
  );
  const activeDepartments = useMemo(
    () => parseList(searchParams.get("department")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchKey],
  );
  const activeCategories = useMemo(
    () => parseList(searchParams.get("category") || searchParams.get("finish")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchKey],
  );
  const departmentOptions = useMemo(
    () =>
      LINX_DEPARTMENTS.map((d) => ({
        label: d.name,
        value: d.slug,
      })),
    [],
  );
  const activeSubcategoryParam = useMemo(
    () => searchParams.get("subcategory")?.trim() || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchKey],
  );
  const activeSort = searchParams.get("sort") || "newest";
  const activeMin = searchParams.get("minPrice") || "";
  const activeMax = searchParams.get("maxPrice") || "";

  const activeBrandKey = activeBrands.join(",");

  /** Parent category tiles for the selected brand(s) — “Shop by Category” */
  const categoryTiles = useMemo((): CatalogueTile[] => {
    if (!activeBrands.length) return [];
    const brands = initialBrandMenus || [];
    const tiles: CatalogueTile[] = [];
    const seen = new Set<string>();

    for (const brand of brands) {
      if (!activeBrands.includes(brand.slug)) continue;
      const parents = (brand.menus || [])
        .filter((m: any) => !m.parent)
        .slice()
        .sort(
          (a: any, b: any) =>
            (a.order ?? 0) - (b.order ?? 0) ||
            String(a.name).localeCompare(String(b.name)),
        );
      for (const menu of parents) {
        if (!menu?.slug || seen.has(menu.slug)) continue;
        seen.add(menu.slug);
        tiles.push({
          name: menu.name,
          slug: menu.slug,
          image: menu.image || brand.image || "",
          count: facetCounts.categoryCounts[menu.slug] ?? 0,
          brandSlug: brand.slug,
        });
      }
    }
    return tiles;
    // activeBrands content keyed via activeBrandKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialBrandMenus,
    activeBrandKey,
    facetCounts.categoryCounts,
  ]);

  const parentSlugSet = useMemo(
    () => new Set(categoryTiles.map((t) => t.slug)),
    [categoryTiles],
  );

  const childToParent = useMemo(() => {
    const map = new Map<string, string>();
    const brandSet = new Set(activeBrands);
    for (const brand of initialBrandMenus || []) {
      if (brandSet.size && !brandSet.has(brand.slug)) continue;
      for (const menu of brand.menus || []) {
        if (menu.parent) continue;
        for (const child of menu.children || []) {
          if (child?.slug) map.set(child.slug, menu.slug);
        }
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBrandMenus, activeBrandKey]);

  /** Active parent category */
  const activeParentSlug = useMemo(() => {
    for (const slug of activeCategories) {
      if (parentSlugSet.has(slug)) return slug;
    }
    for (const slug of activeCategories) {
      const parent = childToParent.get(slug);
      if (parent) return parent;
    }
    if (activeSubcategoryParam) {
      const parent = childToParent.get(activeSubcategoryParam);
      if (parent) return parent;
    }
    return null;
  }, [
    activeCategories,
    parentSlugSet,
    childToParent,
    activeSubcategoryParam,
  ]);

  /** Subcategory tiles for the active parent only (scoped counts) */
  const subcategoryTiles = useMemo((): CatalogueTile[] => {
    if (!activeParentSlug) return [];
    const brands = initialBrandMenus || [];
    const scoped = facetCounts.subcategoryScopedCounts || {};
    const tiles: CatalogueTile[] = [];
    const seen = new Set<string>();
    const brandSet = new Set(activeBrands);

    for (const brand of brands) {
      if (brandSet.size && !brandSet.has(brand.slug)) continue;
      for (const menu of brand.menus || []) {
        if (menu.parent || menu.slug !== activeParentSlug) continue;
        const children = (menu.children || [])
          .slice()
          .sort(
            (a: any, b: any) =>
              (a.order ?? 0) - (b.order ?? 0) ||
              String(a.name).localeCompare(String(b.name)),
          );
        for (const child of children) {
          if (!child?.slug || seen.has(child.slug)) continue;
          seen.add(child.slug);
          const scopedKey = `${activeParentSlug}::${child.slug}`;
          tiles.push({
            name: child.name,
            slug: child.slug,
            image: child.image || menu.image || brand.image || "",
            count: scoped[scopedKey] ?? 0,
            parentSlug: menu.slug,
            parentName: menu.name,
            brandSlug: brand.slug,
          });
        }
      }
    }
    // Keep all type tiles for the active parent (Linx Glass always shows types).
    // Count may briefly be 0 before facets refresh after a migration.
    return tiles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeParentSlug,
    initialBrandMenus,
    activeBrandKey,
    facetCounts.subcategoryScopedCounts,
    activeSubcategoryParam,
  ]);

  const activeSubcategorySlug = useMemo(() => {
    if (activeSubcategoryParam) return activeSubcategoryParam;
    const hit = activeCategories.find(
      (slug) => childToParent.get(slug) === activeParentSlug,
    );
    return hit || null;
  }, [
    activeSubcategoryParam,
    activeCategories,
    childToParent,
    activeParentSlug,
  ]);

  /**
   * Brand-only links (Brand mega menu) keep category unset so “Shop by Category”
   * is a choice. Products mega menu already passes brand + category together.
   */

  const applyCategory = (slug: string | null) => {
    const params = new URLSearchParams(searchKey);
    if (slug) {
      params.set("category", slug);
    } else {
      params.delete("category");
      params.delete("finish");
    }
    params.delete("subcategory");
    params.delete("finish");
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const applySubcategory = (slug: string | null) => {
    const params = new URLSearchParams(searchKey);
    if (activeParentSlug) params.set("category", activeParentSlug);
    if (slug) params.set("subcategory", slug);
    else params.delete("subcategory");
    params.delete("finish");
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    setMinDraft(activeMin);
    setMaxDraft(activeMax);
  }, [activeMin, activeMax]);

  // Always refresh facets (incl. after migrations). Scope to active brand(s)
  // so “Shop by Category” / “Shop by type” counts match the listing.
  useEffect(() => {
    let cancelled = false;

    const loadFacets = async () => {
      const brands = (initialBrandMenus || []).map((b: any) => ({
        slug: b.slug,
        name: b.name,
        categorySlugs: brandSlugToCategories[b.slug] || [],
      }));
      const counts = await getCatalogFacetCounts({
        brands,
        categories: categoryOptionsBase.map((opt) => ({
          slug: opt.value,
          name: opt.label,
        })),
        brand: activeBrands.length ? activeBrands : undefined,
      });
      if (!cancelled) setFacetCounts(counts);
    };

    loadFacets();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by activeBrandKey
  }, [
    initialBrandMenus,
    brandSlugToCategories,
    categoryOptionsBase,
    activeBrandKey,
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
      activeDepartments.length ||
      activeCategories.length ||
      activeSubcategoryParam ||
      activeMin ||
      activeMax ||
      (activeSort && activeSort !== "newest"),
  );

  // Stable string keys so Map/Set identity changes don't re-fetch forever
  const parentSlugsKey = useMemo(
    () => [...parentSlugSet].sort().join(","),
    [parentSlugSet],
  );
  const childParentKey = useMemo(
    () =>
      [...childToParent.entries()]
        .map(([c, p]) => `${c}:${p}`)
        .sort()
        .join("|"),
    [childToParent],
  );

  /** slug → display name for categories / types */
  const menuNameBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const brand of initialBrandMenus || []) {
      for (const menu of brand.menus || []) {
        if (menu.slug) map.set(menu.slug, menu.name);
        for (const child of menu.children || []) {
          if (child?.slug) map.set(child.slug, child.name);
        }
      }
    }
    return map;
  }, [initialBrandMenus]);

  const brandNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const brand of initialBrandMenus || []) {
      if (brand._id) map.set(String(brand._id), brand.name);
      if (brand.slug) map.set(brand.slug, brand.name);
    }
    return map;
  }, [initialBrandMenus]);

  const brandSlugById = useMemo(() => {
    const map = new Map<string, string>();
    for (const brand of initialBrandMenus || []) {
      if (brand._id && brand.slug) map.set(String(brand._id), brand.slug);
    }
    return map;
  }, [initialBrandMenus]);

  const resolveBrandName = (product: any) => {
    if (product?.brand != null) {
      const id = String(
        typeof product.brand === "object"
          ? product.brand._id || product.brand
          : product.brand,
      );
      const byId = brandNameById.get(id);
      if (byId) return byId;
    }
    if (activeBrands.length === 1) {
      return brandNameById.get(activeBrands[0]) || undefined;
    }
    return undefined;
  };

  const resolveBrandSlug = (product: any) => {
    if (product?.brand != null) {
      const id = String(
        typeof product.brand === "object"
          ? product.brand._id || product.brand
          : product.brand,
      );
      const byId = brandSlugById.get(id);
      if (byId) return byId;
    }
    if (activeBrands.length === 1) return activeBrands[0];
    return undefined;
  };

  useEffect(() => {
    const params = new URLSearchParams(searchKey);
    const page = params.get("page") ? Number(params.get("page")) : 1;
    const sort = params.get("sort") || "newest";
    const minPrice = params.get("minPrice");
    const maxPrice = params.get("maxPrice");
    const search = params.get("search") || params.get("q") || undefined;
    const sizes = parseList(params.get("size"));
    const brands = parseList(params.get("brand"));
    const departments = parseList(params.get("department"));
    const categories = parseList(
      params.get("category") || params.get("finish"),
    );
    const subcategory = params.get("subcategory")?.trim() || undefined;

    // Resolve parent vs child when legacy URLs put child in category=
    let parentForQuery: string | string[] | undefined =
      categories.length > 0
        ? categories
        : browseAll || slug === "all"
          ? undefined
          : slug;
    let subForQuery: string | undefined = subcategory;

    if (!subForQuery && categories.length === 1) {
      const maybeChild = categories[0];
      const parent = childToParent.get(maybeChild);
      if (parent) {
        parentForQuery = parent;
        subForQuery = maybeChild;
      }
    }

    // When subcategory is set with parent in category=, filter both
    if (
      subForQuery &&
      categories.length === 1 &&
      parentSlugSet.has(categories[0])
    ) {
      parentForQuery = categories[0];
    }

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
      departments.length === 0 &&
      categories.length === 0 &&
      !subcategory &&
      !minPrice &&
      !maxPrice &&
      !search &&
      (!params.get("sort") || sort === "newest") &&
      page === 1 &&
      (browseAll || slug === "all");

    if (isDefaultView && initialProducts) {
      setData(initialProducts);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const fetchProducts = async () => {
      setIsLoading(true);
      const result = await getPublicProducts({
        category: parentForQuery,
        subCategory: subForQuery,
        size: sizes.length ? sizes : undefined,
        brand: brands.length ? brands : undefined,
        department: departments.length ? departments : undefined,
        brandCategorySlugs,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        sort,
        search,
        page,
        limit: 12,
        fields:
          "name price images category subCategory stock shopifyVariantId specs brand",
      });
      if (cancelled) return;
      setData(result);
      setIsLoading(false);
    };

    fetchProducts();
    return () => {
      cancelled = true;
    };
    // parentSlugsKey / childParentKey stand in for Map/Set identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slug,
    browseAll,
    searchKey,
    initialProducts,
    brandSlugToCategories,
    parentSlugsKey,
    childParentKey,
  ]);

  const breadcrumbHref =
    browseAll || slug === "all" ? "/category" : `/category/${slug}`;

  const activeCategoryTile = useMemo(() => {
    if (!activeParentSlug) return null;
    return (
      categoryTiles.find((t) => t.slug === activeParentSlug) ||
      null
    );
  }, [activeParentSlug, categoryTiles]);

  const activeCategoryName = useMemo(() => {
    if (!activeParentSlug) return null;
    if (activeCategoryTile?.name) return activeCategoryTile.name;
    return menuNameBySlug.get(activeParentSlug) || activeParentSlug;
  }, [activeParentSlug, activeCategoryTile, menuNameBySlug]);

  const activeCategoryDescription = useMemo(() => {
    if (!activeParentSlug || !activeCategoryName) return undefined;
    return getCategoryDescription(activeParentSlug, activeCategoryName);
  }, [activeParentSlug, activeCategoryName]);

  /** Category selected (e.g. from Products dropdown) — Glass-style detail, no parent tiles */
  const showCategoryDetail = Boolean(activeParentSlug && activeCategoryName);

  const headerTitle = showCategoryDetail ? activeCategoryName! : title;
  const headerDescription = showCategoryDetail
    ? activeCategoryDescription
    : description;
  const headerBreadcrumb = showCategoryDetail
    ? [
        { label: "Catalogue", href: breadcrumbHref },
        ...(activeBrands.length === 1
          ? [
              {
                label:
                  brandNameById.get(activeBrands[0]) || activeBrands[0],
                href: `${breadcrumbHref}?brand=${encodeURIComponent(activeBrands[0])}`,
              },
            ]
          : []),
        { label: activeCategoryName! },
      ]
    : [{ label: title, href: breadcrumbHref }];

  const filtersPanel = (
    <ShopFilters
      sizes={sizeOptions}
      brands={brandOptions}
      categories={categoryOptions}
      departments={departmentOptions}
      activeSizes={activeSizes}
      activeBrands={activeBrands}
      activeCategories={activeCategories}
      activeDepartments={activeDepartments}
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
        else if (key === "department")
          setListParam(
            "department",
            toggleValue(activeDepartments, value),
          );
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
        initialDepartments={initialDepartments}
        initialStoreName={initialStoreName}
      />
      <PageHeader
        title={headerTitle}
        description={headerDescription}
        breadcrumb={headerBreadcrumb}
        variant={showCategoryDetail ? "catalogue" : "default"}
      />

      <section className="md:py-8 px-6 lg:px-12 xl:px-20">
        <div className="max-w-8xl mx-auto">
          {/* Parent category tiles only when no category is selected yet */}
          {!showCategoryDetail && categoryTiles.length > 0 ? (
            <ShopByTiles
              title="Shop by Category"
              items={categoryTiles}
              activeSlug={activeParentSlug}
              onSelect={applyCategory}
              allowClear
              clearLabel="Clear category ×"
            />
          ) : null}

          {subcategoryTiles.length > 0 ? (
            <ShopByTiles
              title="Shop by type"
              clearLabel="Clear type ×"
              items={subcategoryTiles}
              activeSlug={activeSubcategorySlug}
              onSelect={applySubcategory}
              allowClear
            />
          ) : null}

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
                    {data.products.map((product: any) => {
                      const specs = product.specs || {};
                      const typeSlug = product.subCategory || "";
                      return (
                  <ProductCard
                        key={`${product._id}-${viewMode}`}
                    id={product._id}
                    name={product.name}
                    price={product.price}
                    category={product.category}
                        subCategory={product.subCategory}
                        typeName={
                          typeSlug
                            ? menuNameBySlug.get(typeSlug) || typeSlug
                            : undefined
                        }
                        brandName={resolveBrandName(product)}
                        brandSlug={resolveBrandSlug(product)}
                        sku={specs.sku || undefined}
                        productCode={specs.productCode || undefined}
                        size={specs.size || undefined}
                        salePercent={
                          typeof specs.salePercent === "number"
                            ? specs.salePercent
                            : null
                        }
                        image={getProductDisplayImage(product.images)}
                        stock={product.stock}
                        shopifyVariantId={product.shopifyVariantId}
                        layout={viewMode}
                      />
                      );
                    })}
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
            initialDepartments={props.initialDepartments}
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

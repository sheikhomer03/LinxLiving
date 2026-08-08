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
import {
  ChevronDown,
  Folder,
  LayoutGrid,
  List,
  Loader2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pagination } from "@/components/products/Pagination";
import {
  getCatalogFacetCounts,
  getPublicProducts,
} from "@/app/actions/products";
import { getApprovedReviewSummaries } from "@/app/actions/reviews";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Suspense } from "react";
import { getProductDisplayImage } from "@/lib/productImage";
import { getCategoryDescription } from "@/lib/categoryDescriptions";
import { LINX_DEPARTMENTS } from "@/lib/catalogueTaxonomy";
import { cn } from "@/lib/utils";

const SIZE_OPTIONS = [
  { label: "60 × 60", value: "600x600" },
  { label: "60 × 90", value: "600x900" },
  { label: "60 × 120", value: "600x1200" },
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
  title?: string;
  description?: string;
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
  // Collapsed by default — the grid gets the full width and shoppers opt in
  // to filtering via the "Show filters" button in the toolbar.
  const [filtersVisible, setFiltersVisible] = useState(false);
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
  const [facetsLoading, setFacetsLoading] = useState(!initialFacetCounts);
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
  const [reviewSummaries, setReviewSummaries] = useState<
    Record<string, { average: number; count: number }>
  >({});
  /** When set, products for this searchKey came from SSR — don't refetch. */
  const servedProductsKeyRef = useRef<string | null>(null);
  const facetsBrandKeyRef = useRef<string | null>(
    initialFacetCounts ? "|" : null,
  );
  const initialProductsRef = useRef(initialProducts);
  initialProductsRef.current = initialProducts;

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

  /** Department slug → brand slugs that own categories in that department. */
  const departmentBrandSlugs = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const dept of initialDepartments || []) {
      const slugs = new Set<string>();
      for (const b of dept.brands || []) {
        if (b?.slug) slugs.add(String(b.slug));
      }
      if (dept.slug) map.set(String(dept.slug), slugs);
    }
    return map;
  }, [initialDepartments]);

  /** Department slug → top-level category slugs in that department tree. */
  const departmentCategorySlugs = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const dept of initialDepartments || []) {
      const slugs = new Set<string>();
      for (const c of dept.categories || []) {
        if (c?.slug) slugs.add(String(c.slug));
      }
      if (dept.slug) map.set(String(dept.slug), slugs);
    }
    return map;
  }, [initialDepartments]);

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
  const activeSubBrands = useMemo(
    () =>
      parseList(searchParams.get("subBrand")).map((s) => s.toLowerCase()),
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
  const departmentOptions = useMemo(() => {
    const fromTrees = (initialDepartments || [])
      .filter((d: any) => d?.slug && d?.name)
      .map((d: any) => ({ label: d.name, value: d.slug }));
    if (fromTrees.length) return fromTrees;
    return LINX_DEPARTMENTS.map((d) => ({
      label: d.name,
      value: d.slug,
    }));
  }, [initialDepartments]);
  const activeSubcategoryParam = useMemo(
    () => searchParams.get("subcategory")?.trim() || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchKey],
  );
  const activeSort = searchParams.get("sort") || "newest";
  const activeMin = searchParams.get("minPrice") || "";
  const activeMax = searchParams.get("maxPrice") || "";

  const activeBrandKey = activeBrands.join(",");
  const activeSubBrandKey = activeSubBrands.join(",");
  const activeDepartmentKey = activeDepartments.join(",");

  const menuMatchesSubBrand = (menu: any) => {
    if (!activeSubBrands.length) return true;
    const list = Array.isArray(menu?.subBrands) && menu.subBrands.length
      ? menu.subBrands.map((s: any) => String(s || "").trim().toLowerCase())
      : String(menu?.subBrand || "")
          .trim()
          .toLowerCase()
        ? [
            String(menu.subBrand)
              .trim()
              .toLowerCase(),
          ]
        : [];
    if (!list.length) return false;
    return activeSubBrands.some((sb) => list.includes(sb));
  };

  const brandsAllowedByDepartment = useMemo(() => {
    if (!activeDepartments.length) return null;
    const allowed = new Set<string>();
    for (const slug of activeDepartments) {
      const set = departmentBrandSlugs.get(slug);
      if (set) for (const b of set) allowed.add(b);
    }
    return allowed;
  }, [activeDepartments, departmentBrandSlugs, activeDepartmentKey]);

  const categoriesAllowedByDepartment = useMemo(() => {
    if (!activeDepartments.length) return null;
    const allowed = new Set<string>();
    for (const slug of activeDepartments) {
      const set = departmentCategorySlugs.get(slug);
      if (set) for (const c of set) allowed.add(c);
    }
    return allowed;
  }, [activeDepartments, departmentCategorySlugs, activeDepartmentKey]);

  // Brands under the selected department(s). With no department, show all
  // brands that have products. Zero-count rows stay hidden.
  const brandOptions = useMemo(() => {
    return (initialBrandMenus || [])
      .filter((b: any) =>
        brandsAllowedByDepartment
          ? brandsAllowedByDepartment.has(b.slug)
          : true,
      )
      .map((b: any) => ({
        label: b.name,
        value: b.slug,
        count: facetCounts.brandCounts[b.slug] ?? 0,
      }))
      .filter((b) => b.count > 0);
  }, [
    initialBrandMenus,
    facetCounts.brandCounts,
    brandsAllowedByDepartment,
  ]);

  /**
   * Categories follow brand (and department when set):
   * - brand selected → that brand's top-level ranges
   * - department only → categories in those department trees
   * - neither → all categories with stock
   */
  const categoryOptions = useMemo(() => {
    let scoped = categoryOptionsBase;

    if (activeBrands.length) {
      const allowed = new Set<string>();
      for (const brand of initialBrandMenus || []) {
        if (!activeBrands.includes(brand.slug)) continue;
        for (const menu of brand.menus || []) {
          if (!menu.parent && menuMatchesSubBrand(menu)) {
            allowed.add(menu.slug);
          }
        }
      }
      scoped = scoped.filter((o) => allowed.has(o.value));
    }

    if (categoriesAllowedByDepartment) {
      scoped = scoped.filter((o) =>
        categoriesAllowedByDepartment.has(o.value),
      );
    }

    // Brand required for a focused category list once a department is chosen
    // and no brand is picked yet — otherwise Brand → Category cascade is unclear.
    // Accessories is the exception: its categories *are* the accessory ranges.
    const accessoriesOnly =
      activeDepartments.length === 1 &&
      activeDepartments[0] === "accessories";
    if (activeDepartments.length && !activeBrands.length && !accessoriesOnly) {
      return [];
    }

    return scoped
      .map((opt) => ({
        ...opt,
        count: facetCounts.categoryCounts[opt.value] ?? 0,
      }))
      .filter((opt) => opt.count > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categoryOptionsBase,
    facetCounts.categoryCounts,
    initialBrandMenus,
    activeBrandKey,
    activeSubBrandKey,
    activeDepartmentKey,
    categoriesAllowedByDepartment,
  ]);

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
        if (!menuMatchesSubBrand(menu)) continue;
        seen.add(menu.slug);
        tiles.push({
          name: menu.name,
          slug: menu.slug,
          image: menu.image || "",
          count: facetCounts.categoryCounts[menu.slug] ?? 0,
          brandSlug: brand.slug,
          fromPricePerSqm: (facetCounts as any).fromPriceByCategory?.[menu.slug],
        });
      }
    }

    // Drop ranges with nothing behind them — a "Carpet (0)" tile only leads to
    // an empty page. Counts arrive after the facet fetch, so the tiles are
    // left alone until at least one count is known, otherwise every tile would
    // vanish for a moment on first paint.
    const countsLoaded = tiles.some((t) => t.count > 0);
    return countsLoaded ? tiles.filter((t) => t.count > 0) : tiles;
    // activeBrands content keyed via activeBrandKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialBrandMenus,
    activeBrandKey,
    activeSubBrandKey,
    facetCounts.categoryCounts,
    (facetCounts as any).fromPriceByCategory,
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
        if (!menuMatchesSubBrand(menu)) continue;
        for (const child of menu.children || []) {
          if (child?.slug) map.set(child.slug, menu.slug);
        }
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBrandMenus, activeBrandKey, activeSubBrandKey]);

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
    const bySub = facetCounts.subcategoryCounts || {};
    const tiles: CatalogueTile[] = [];
    const seen = new Set<string>();
    const brandSet = new Set(activeBrands);

    for (const brand of brands) {
      if (brandSet.size && !brandSet.has(brand.slug)) continue;
      for (const menu of brand.menus || []) {
        if (menu.parent || menu.slug !== activeParentSlug) continue;
        if (!menuMatchesSubBrand(menu)) continue;
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
          // Prefer parent-scoped count; fall back to global sub / collection
          // membership count so shared Shopify leaves (Thermal Imaging under
          // Electric + Water, etc.) do not show (0) under the non-primary parent.
          const count = Math.max(
            scoped[scopedKey] ?? 0,
            bySub[child.slug] ?? 0,
          );
          tiles.push({
            name: child.name,
            slug: child.slug,
            // Prefer the subcategory's own cover — do not fall back to the
            // parent image (that made every "Shop by type" tile look identical).
            image: child.image || "",
            count,
            parentSlug: menu.slug,
            parentName: menu.name,
            brandSlug: brand.slug,
            fromPricePerSqm: (facetCounts as any).fromPriceBySubcategory?.[
              child.slug
            ],
          });
        }
      }
    }
    // Same rule as the category tiles: hide types with nothing behind them,
    // but only once counts have actually arrived.
    const countsLoaded = tiles.some((t) => t.count > 0);
    return countsLoaded ? tiles.filter((t) => t.count > 0) : tiles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeParentSlug,
    initialBrandMenus,
    activeBrandKey,
    activeSubBrandKey,
    facetCounts.subcategoryScopedCounts,
    facetCounts.subcategoryCounts,
    (facetCounts as any).fromPriceBySubcategory,
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

  // Facet counts — load once per brand/sub-brand scope; skip if SSR already
  // supplied the same scope (empty brand key = global).
  useEffect(() => {
    const key = `${activeBrandKey || ""}|${activeSubBrandKey || ""}`;
    if (facetsBrandKeyRef.current === key && initialFacetCounts) {
      setFacetsLoading(false);
      return;
    }
    // First paint with SSR global facets and no brand filter
    if (
      initialFacetCounts &&
      facetsBrandKeyRef.current === "" &&
      key === "|"
    ) {
      setFacetsLoading(false);
      return;
    }

    let cancelled = false;
    setFacetsLoading(true);

    const loadFacets = async () => {
      try {
        const counts = await getCatalogFacetCounts({
          brand: activeBrands.length ? activeBrands : undefined,
          subBrand: activeSubBrands.length ? activeSubBrands : undefined,
        });
        if (cancelled) return;
        setFacetCounts(counts);
        facetsBrandKeyRef.current = key;
      } finally {
        if (!cancelled) setFacetsLoading(false);
      }
    };

    loadFacets();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by brand+subBrand
  }, [activeBrandKey, activeSubBrandKey]);

  const setListParam = (key: string, values: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (values.length) params.set(key, values.join(","));
    else params.delete(key);
    // Drop legacy finish param when updating category
    if (key === "category") params.delete("finish");
    params.set("page", "1");
    router.push(`?${params.toString()}`, { scroll: false });
  };

  /** Write several filter lists in one navigation (cascade cleanup). */
  const setFilterLists = (next: {
    department?: string[];
    brand?: string[];
    subBrand?: string[];
    category?: string[];
  }) => {
    const params = new URLSearchParams(searchParams.toString());
    const write = (key: string, values: string[] | undefined) => {
      if (values === undefined) return;
      if (values.length) params.set(key, values.join(","));
      else params.delete(key);
    };
    write("department", next.department);
    write("brand", next.brand);
    write("subBrand", next.subBrand);
    write("category", next.category);
    if (next.category !== undefined) {
      params.delete("finish");
      params.delete("subcategory");
    }
    if (next.brand !== undefined && next.subBrand === undefined) {
      // Changing brand clears sub-brand unless explicitly set
      params.delete("subBrand");
    }
    params.set("page", "1");
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const brandSlugsForDepartments = (deptSlugs: string[]) => {
    if (!deptSlugs.length) return null;
    const allowed = new Set<string>();
    for (const slug of deptSlugs) {
      const set = departmentBrandSlugs.get(slug);
      if (set) for (const b of set) allowed.add(b);
    }
    return allowed;
  };

  const categorySlugsForBrands = (brandSlugs: string[]) => {
    const allowed = new Set<string>();
    for (const brand of initialBrandMenus || []) {
      if (!brandSlugs.includes(brand.slug)) continue;
      for (const menu of brand.menus || []) {
        if (!menu.parent && menu.slug) allowed.add(menu.slug);
      }
    }
    return allowed;
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

  const activeColours = useMemo(
    () => parseList(searchParams.get("colour") || searchParams.get("color")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchKey],
  );
  const activeStyles = useMemo(
    () => parseList(searchParams.get("style")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchKey],
  );

  const hasActiveFilters = Boolean(
    activeSizes.length ||
      activeBrands.length ||
      activeSubBrands.length ||
      activeDepartments.length ||
      activeCategories.length ||
      activeColours.length ||
      activeStyles.length ||
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
      const label =
        String(brand.displayName || "").trim() ||
        String(brand.uiName || "").trim() ||
        String(brand.name || "").trim();
      if (brand._id) map.set(String(brand._id), label);
      if (brand.slug) map.set(brand.slug, label);
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
      // Only the product's own brand — never inherit the active filter brand
      // (that incorrectly labelled Sterlingbuild SKUs as FAKRO).
      if (byId) return byId;
      return undefined;
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
      return undefined;
    }
    return undefined;
  };

  useEffect(() => {
    const productKey = `${slug}|${browseAll ? "all" : "cat"}|${searchKey}`;

    // Optional SSR hand-off: use server products once for the matching URL.
    if (
      initialProductsRef.current &&
      servedProductsKeyRef.current === null
    ) {
      servedProductsKeyRef.current = productKey;
      setData(initialProductsRef.current);
      setIsLoading(false);
      // Still continue if URL filters differ from empty SSR defaults — handled
      // below when searchKey is non-empty and browseAll default was assumed.
      if (!searchKey && (browseAll || slug === "all")) {
        return;
      }
      // For /category/[slug] with SSR products and no query string, keep SSR.
      if (!searchKey && !browseAll && slug !== "all") {
        return;
      }
      // Otherwise fall through and fetch for the actual filters.
      servedProductsKeyRef.current = null;
    }

    const params = new URLSearchParams(searchKey);
    const page = params.get("page") ? Number(params.get("page")) : 1;
    const sort = params.get("sort") || "newest";
    const minPrice = params.get("minPrice");
    const maxPrice = params.get("maxPrice");
    const search = params.get("search") || params.get("q") || undefined;
    const sizes = parseList(params.get("size"));
    const brands = parseList(params.get("brand"));
    const subBrands = parseList(params.get("subBrand"));
    const departments = parseList(params.get("department"));
    const colours = parseList(
      params.get("colour") || params.get("color"),
    );
    const styles = parseList(params.get("style"));
    const ranges = parseList(params.get("range"));
    const onSale =
      params.get("onSale") === "1" ||
      params.get("onSale") === "true" ||
      params.get("sale") === "1";
    const categories = parseList(
      params.get("category") || params.get("finish"),
    );
    const subcategory = params.get("subcategory")?.trim() || undefined;

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

    if (
      subForQuery &&
      categories.length === 1 &&
      parentSlugSet.has(categories[0])
    ) {
      parentForQuery = categories[0];
    }

    let cancelled = false;
    setIsLoading(true);

    const fetchProducts = async () => {
      try {
        const result = await getPublicProducts({
          category: parentForQuery,
          subCategory: subForQuery,
          size: sizes.length ? sizes : undefined,
          brand: brands.length ? brands : undefined,
          subBrand: subBrands.length ? subBrands : undefined,
          department: departments.length ? departments : undefined,
          colour: colours.length ? colours : undefined,
          style: styles.length ? styles : undefined,
          range: ranges.length ? ranges : undefined,
          minPrice: minPrice ? Number(minPrice) : undefined,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
          sort,
          search,
          page,
        limit: 12,
          onSale: onSale || undefined,
          fields:
            "name price images category subCategory department stock shopifyVariantId specs brand subBrand vatRate colorOptions",
        });
        if (cancelled) return;
      setData(result);
        servedProductsKeyRef.current = productKey;
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchProducts();
    return () => {
      cancelled = true;
    };
    // parentSlugsKey / childParentKey stand in for Map/Set identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, browseAll, searchKey, parentSlugsKey, childParentKey]);

  const reviewProductIdsKey = useMemo(
    () =>
      (data.products || [])
        .map((p: any) => String(p._id || ""))
        .filter(Boolean)
        .join(","),
    [data.products],
  );

  useEffect(() => {
    let cancelled = false;
    const ids = reviewProductIdsKey ? reviewProductIdsKey.split(",") : [];
    if (!ids.length) {
      setReviewSummaries({});
      return;
    }
    (async () => {
      try {
        const summaries = await getApprovedReviewSummaries(ids);
        if (!cancelled) setReviewSummaries(summaries || {});
      } catch {
        if (!cancelled) setReviewSummaries({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewProductIdsKey]);

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

  /** Used only for the hidden h1 when no visible title is set. */
  const srTitle =
    activeCategoryName ||
    activeBrands[0] ||
    initialDepartments?.find((d: any) => activeDepartments.includes(d.slug))
      ?.name ||
    "Catalogue";
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
        ...(activeSubBrands.length === 1 && activeBrands.length === 1
          ? [
              {
                label:
                  (initialBrandMenus || [])
                    .find((b: any) => b.slug === activeBrands[0])
                    ?.subBrands?.find(
                      (s: any) => s.slug === activeSubBrands[0],
                    )?.name || activeSubBrands[0],
                href: `${breadcrumbHref}?brand=${encodeURIComponent(activeBrands[0])}&subBrand=${encodeURIComponent(activeSubBrands[0])}`,
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
        if (key === "size") {
          setListParam("size", toggleValue(activeSizes, value));
          return;
        }

        if (key === "department") {
          const nextDepartments = toggleValue(activeDepartments, value);
          const allowedBrands = brandSlugsForDepartments(nextDepartments);
          const nextBrands = allowedBrands
            ? activeBrands.filter((b) => allowedBrands.has(b))
            : activeBrands;
          const allowedCats = nextBrands.length
            ? categorySlugsForBrands(nextBrands)
            : null;
          const accessoriesOnly =
            nextDepartments.length === 1 &&
            nextDepartments[0] === "accessories";
          const nextCategories =
            nextDepartments.length && !nextBrands.length && !accessoriesOnly
              ? []
              : allowedCats
                ? activeCategories.filter((c) => allowedCats.has(c))
                : activeCategories;
          setFilterLists({
            department: nextDepartments,
            brand: nextBrands,
            subBrand: [],
            category: nextCategories,
          });
          return;
        }

        if (key === "brand") {
          const nextBrands = toggleValue(activeBrands, value);
          const allowedCats = nextBrands.length
            ? categorySlugsForBrands(nextBrands)
            : null;
          const accessoriesOnly =
            activeDepartments.length === 1 &&
            activeDepartments[0] === "accessories";
          const nextCategories =
            activeDepartments.length && !nextBrands.length && !accessoriesOnly
              ? []
              : allowedCats
                ? activeCategories.filter((c) => allowedCats.has(c))
                : activeCategories;
          setFilterLists({
            brand: nextBrands,
            subBrand: [],
            category: nextCategories,
          });
          return;
        }

        setListParam("category", toggleValue(activeCategories, value));
      }}
      onClear={clearFilters}
      hasActiveFilters={hasActiveFilters}
      brandEmptyHint={
        activeDepartments.length
          ? "No brands in the selected department"
          : undefined
      }
      categoryEmptyHint={
        activeDepartments.length &&
        !activeBrands.length &&
        !(
          activeDepartments.length === 1 &&
          activeDepartments[0] === "accessories"
        )
          ? "Select a brand to see categories"
          : activeBrands.length
            ? "No categories for the selected brand"
            : undefined
      }
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

      {/* The catalogue landing page shows no visible heading by design, but a
          page still needs one h1 for search engines and screen readers. */}
      {!headerTitle ? (
        <h1 className="sr-only">{srTitle}</h1>
      ) : null}

      <section className="py-4 md:py-8 px-4 sm:px-6 lg:px-12 xl:px-20">
        <div className="max-w-8xl mx-auto">
          {/* Shop by Category / Shop by type — temporarily hidden
          {facetsLoading &&
          !showCategoryDetail &&
          categoryTiles.length === 0 ? (
            <div className="mb-8 flex items-center gap-2 text-foreground/55">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[11px] uppercase tracking-[0.2em] font-bold">
                Loading categories…
              </span>
            </div>
          ) : null}

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
          */}

          {/* Toolbar — Hide filters + results + sort */}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 mb-6 sm:mb-8 py-3 sm:py-4 border-b border-foreground/10">
            <div className="flex items-center justify-between gap-3 sm:contents">
            <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined" && window.innerWidth < 1024) {
                    setMobileFiltersOpen(true);
                  } else {
                    setFiltersVisible((v) => !v);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-full border border-foreground/20 px-3 sm:px-4 py-2 text-[11px] sm:text-[12px] font-medium tracking-wide hover:border-foreground/40 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="lg:hidden">Filters</span>
                <span className="hidden lg:inline">
                  {filtersVisible ? "Hide filters" : "Show filters"}
                </span>
            </button>
              <p className="text-[12px] sm:text-[13px] text-foreground/70 tracking-wide inline-flex items-center gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading results…
                  </>
                ) : (
                  <>{data.total.toLocaleString("en-GB")} Results</>
                )}
              </p>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 sm:ml-auto w-full sm:w-auto">
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
                <div className="sticky top-28 pb-10 relative">
                  {facetsLoading ? (
                    <div className="mb-3 inline-flex items-center gap-2 text-foreground/50">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span className="text-[10px] uppercase tracking-[0.18em] font-bold">
                        Updating filters…
                      </span>
                    </div>
                  ) : null}
                  <div className={cn(facetsLoading && "opacity-60")}>
                    {filtersPanel}
                  </div>
                </div>
              </aside>
            )}

            {/* Product grid */}
            <div
              className={cn(
                filtersVisible ? "lg:col-span-9 xl:col-span-9" : "lg:col-span-1",
              )}
            >
          {isLoading ? (
                <div className="mb-16 space-y-6">
                  <div className="flex items-center gap-2 text-foreground/55">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-[11px] uppercase tracking-[0.2em] font-bold">
                      Loading products…
                    </span>
                  </div>
                  <div
                    className={cn(
                      "opacity-90 animate-pulse",
                      viewMode === "list"
                        ? "flex flex-col gap-4"
                        : cn(
                            "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-6",
                            filtersVisible
                              ? "xl:grid-cols-3"
                              : "xl:grid-cols-4",
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
                      const catSlug = product.category || "";
                      const review = reviewSummaries[String(product._id)];
                      const compareRaw =
                        specs.shopifyCompareAt ?? specs.compareAtPrice;
                      const compareAt =
                        compareRaw != null && Number(compareRaw) > 0
                          ? Number(compareRaw)
                          : null;
                      // Raise-then-%: price is the raised actual; only salePercent
                      // should discount. Avoid compareAt===price blocking the sale.
                      const raiseThenPercent =
                        String(specs.salePriceMode || "") ===
                        "raise-then-percent";
                      const salePercent =
                        typeof specs.salePercent === "number"
                          ? specs.salePercent
                          : null;
                      return (
                  <ProductCard
                          key={`${product._id}-${viewMode}`}
                    id={product._id}
                    name={product.name}
                    price={product.price}
                    category={product.category}
                          categoryName={
                            catSlug
                              ? menuNameBySlug.get(catSlug) || catSlug
                              : undefined
                          }
                          subCategory={product.subCategory}
                          department={product.department}
                          typeName={
                            typeSlug
                              ? menuNameBySlug.get(typeSlug) || typeSlug
                              : undefined
                          }
                          brandName={resolveBrandName(product)}
                          brandSlug={resolveBrandSlug(product)}
                          priceMode={specs.priceDisplay || undefined}
                          pricePerM2={
                            Number(specs.pricePerM2) > 0
                              ? Number(specs.pricePerM2)
                              : null
                          }
                          size={specs.size || undefined}
                          salePercent={salePercent}
                          compareAtPrice={
                            raiseThenPercent
                              ? null
                              : compareAt != null &&
                                  compareAt > Number(product.price)
                                ? compareAt
                                : null
                          }
                          vatRate={
                            product.vatRate == null ? 20 : Number(product.vatRate)
                          }
                          image={getProductDisplayImage(product.images)}
                          images={product.images}
                          colorOptions={
                            Array.isArray(product.colorOptions)
                              ? product.colorOptions
                              : undefined
                          }
                          stock={product.stock}
                          shopifyVariantId={product.shopifyVariantId}
                          averageRating={review?.average ?? 0}
                          reviewCount={review?.count ?? 0}
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
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-foreground/60">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className="text-[11px] uppercase tracking-[0.22em] font-bold">
              Loading catalogue…
            </p>
          </div>
          <Footer initialStoreName={props.initialStoreName} />
        </div>
      }
    >
      <CategoryPageContent {...props} />
    </Suspense>
  );
}

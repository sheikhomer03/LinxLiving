"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Search,
  ShoppingBag,
  User,
  Menu,
  Phone,
  X,
  Heart,
  ChevronDown,
  ChevronRight,
  MapPin,
  Loader2,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useWishlistDrawerStore } from "@/store/useWishlistDrawerStore";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import ConfirmationModal from "@/components/common/ConfirmationModal";
import { getStoreName } from "@/app/actions/settings";
import { getPublicProducts } from "@/app/actions/products";
import { SearchBar } from "./SearchBar";
import { getProductDisplayImage } from "@/lib/productImage";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { subscribeCatalogChange } from "@/lib/live-sync";

type MenuNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  children?: MenuNode[];
};

type MegaProduct = {
  _id: string;
  name: string;
  price: number;
  images?: string[];
  category?: string;
};

type MegaTab = string | null;

type BrandWithMenus = {
  _id: string;
  name: string;
  slug: string;
  order: number;
  image?: string;
  menus: MenuNode[];
};

// const PROJECT_LINKS = [
//   { label: "Home projects", href: "/contact", note: "Private residences" },
//   { label: "Hotels & hospitality", href: "/contact", note: "Commercial suites" },
//   { label: "Restaurants & retail", href: "/contact", note: "Public interiors" },
//   { label: "Offices & workplaces", href: "/contact", note: "Corporate spaces" },
//   { label: "Start a project", href: "/custom", note: "Bespoke enquiry" },
// ];

const ABOUT_LINKS = [
  { label: "Our world", href: "/contact", note: "Brand & craft" },
  { label: "Buying guides", href: "/faq", note: "Expert advice" },
  { label: "Delivery & returns", href: "/shipping-returns", note: "Orders" },
  { label: "Privacy policy", href: "/privacy", note: "Legal" },
];

/** Catalogue deep-link with Brand / Category filters pre-applied */
function catalogueHref(opts: { brand?: string | null; category?: string | null }) {
  const params = new URLSearchParams();
  if (opts.brand) params.set("brand", opts.brand);
  if (opts.category) params.set("category", opts.category);
  const q = params.toString();
  return q ? `/category?${q}` : "/category";
}

export function Navbar({
  initialBrandMenus,
  initialStoreName,
}: {
  initialBrandMenus?: BrandWithMenus[];
  initialStoreName?: string;
}) {
  return (
    <NavbarContent
      initialBrandMenus={initialBrandMenus}
      initialStoreName={initialStoreName}
    />
  );
}

function NavbarContent({
  initialBrandMenus,
  initialStoreName,
}: {
  initialBrandMenus?: BrandWithMenus[];
  initialStoreName?: string;
}) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { getTotalItems } = useCartStore();
  const openCart = useCartDrawerStore((s) => s.open);
  const openWishlist = useWishlistDrawerStore((s) => s.open);
  const { items: wishlistItems } = useWishlistStore();
  const [mounted, setMounted] = useState(false);
  const { data: session, status } = useSession();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [storeName, setStoreName] = useState(
    initialStoreName || "Linx Square",
  );
  const [brandMenus, setBrandMenus] = useState<BrandWithMenus[]>(
    initialBrandMenus?.length ? initialBrandMenus : [],
  );
  const [menusLoading, setMenusLoading] = useState(
    !initialBrandMenus?.length,
  );
  const [activeTab, setActiveTab] = useState<MegaTab>(null);
  const [activeProductFamily, setActiveProductFamily] = useState<string | null>(
    null,
  );
  const [mobileSection, setMobileSection] = useState<MegaTab>(null);
  const [megaProductsBySlug, setMegaProductsBySlug] = useState<
    Record<string, MegaProduct[]>
  >({});
  const [megaProductsLoading, setMegaProductsLoading] = useState(false);
  const megaProductsCacheRef = useRef<Record<string, MegaProduct[]>>({});
  const brandMenusRef = useRef(brandMenus);
  brandMenusRef.current = brandMenus;
  const pathname = usePathname();

  const loadFamilyProducts = async (
    family: MenuNode,
    opts?: { force?: boolean },
  ) => {
    const cacheKey = family.slug;
    if (!opts?.force && megaProductsCacheRef.current[cacheKey]?.length) {
      return megaProductsCacheRef.current[cacheKey];
    }

    const categoryKeys = [
      family.slug,
      family.name,
      ...(family.children || []).flatMap((c) => [c.slug, c.name]),
    ].filter(Boolean);

    try {
      const result = await getPublicProducts({
        category: categoryKeys,
        limit: 3,
        sort: "newest",
        fields: "name price images category",
        skipCount: true,
      });
      const products = (result.products || []) as MegaProduct[];
      megaProductsCacheRef.current[cacheKey] = products;
      setMegaProductsBySlug((prev) => ({
        ...prev,
        [cacheKey]: products,
      }));
      return products;
    } catch {
      return megaProductsCacheRef.current[cacheKey] || [];
    }
  };

  const prefetchAllMegaProducts = async (
    brands: BrandWithMenus[],
    opts?: { force?: boolean },
  ) => {
    const families = brands.flatMap((brand) => brand.menus || []);
    if (!families.length) return;
    await Promise.all(
      families.map((family) => loadFamilyProducts(family, opts)),
    );
  };

  const brandMenusContentKey = (brands: BrandWithMenus[] | undefined) =>
    JSON.stringify(
      (brands || []).map((b) => ({
        id: b._id,
        image: b.image,
        menus: (b.menus || []).map((m) => [m._id, m.name, m.image]),
      })),
    );

  const initialMenusKeyRef = useRef<string>("");

  useEffect(() => {
    if (!initialBrandMenus?.length) return;
    const nextKey = brandMenusContentKey(initialBrandMenus);
    // Skip when RSC soft-nav passes a new array with the same menus
    if (nextKey === initialMenusKeyRef.current) return;
    initialMenusKeyRef.current = nextKey;
    setBrandMenus(initialBrandMenus);
    setMenusLoading(false);
    prefetchAllMegaProducts(initialBrandMenus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content-keyed
  }, [initialBrandMenus]);

  useEffect(() => {
    if (initialStoreName) {
      setStoreName(initialStoreName);
    } else {
      getStoreName().then((name) => setStoreName(name));
    }

    let cancelled = false;
    const hasInitial = Boolean(initialBrandMenus?.length);

    const refreshBrands = async (opts?: { forceProducts?: boolean }) => {
      try {
        if (!brandMenusRef.current.length) {
          setMenusLoading(true);
        }

        const { getBrandMenuTrees } = await import("@/app/actions/admin");
        const result = await getBrandMenuTrees();
        if (cancelled) return;

        const next =
          result.success && result.brands?.length ? result.brands : [];
        setBrandMenus((prev) => {
          const prevKey = JSON.stringify(
            prev.map((b) => ({
              id: b._id,
              image: b.image,
              menus: (b.menus || []).map((m) => [m._id, m.name, m.image]),
            })),
          );
          const nextKey = JSON.stringify(
            next.map((b: any) => ({
              id: b._id,
              image: b.image,
              menus: (b.menus || []).map((m: any) => [m._id, m.name, m.image]),
            })),
          );
          if (prevKey !== nextKey || opts?.forceProducts) {
            megaProductsCacheRef.current = {};
            setMegaProductsBySlug({});
          }
          return next;
        });

        if (!cancelled) {
          await prefetchAllMegaProducts(next, {
            force: opts?.forceProducts,
          });
        }
      } catch {
        if (cancelled) return;
        if (!brandMenusRef.current.length) setBrandMenus([]);
      } finally {
        if (!cancelled) setMenusLoading(false);
      }
    };

    if (!hasInitial) {
      refreshBrands();
    }

    const unsubscribe = subscribeCatalogChange(() => {
      megaProductsCacheRef.current = {};
      setMegaProductsBySlug({});
      refreshBrands({ forceProducts: true });
    }, ["brands", "menus", "products", "all"]);

    setMounted(true);
    const handleScroll = () => setIsScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handleScroll);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("scroll", handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once; props sync via separate effect
  }, []);

  useEffect(() => {
    setIsMenuOpen(false);
    setActiveTab(null);
    setIsSearchOpen(false);
    setMobileSection(null);
  }, [pathname]);

  const allCategories = (() => {
    const seen = new Set<string>();
    const items: {
      family: MenuNode;
      brandSlug: string;
      brandName: string;
    }[] = [];
    for (const brand of brandMenus) {
      for (const family of brand.menus || []) {
        const key = family.slug || family._id;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          family,
          brandSlug: brand.slug,
          brandName: brand.name,
        });
      }
    }
    return items;
  })();
  const categoryKey = allCategories.map((c) => c.family._id).join(",");

  useEffect(() => {
    if (activeTab !== "products") return;
    if (allCategories[0]) {
      setActiveProductFamily((prev) => {
        const stillValid = allCategories.some((c) => c.family._id === prev);
        return stillValid && prev ? prev : allCategories[0].family._id;
      });
    } else {
      setActiveProductFamily(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, categoryKey]);

  const selectedCategory =
    allCategories.find((c) => c.family._id === activeProductFamily) ||
    allCategories[0] ||
    null;
  const selectedFamily = selectedCategory?.family || null;

  // Load products for the selected menu when Products mega is open
  useEffect(() => {
    if (activeTab !== "products" || !selectedFamily?.slug) return;

    let cancelled = false;
    const cached = megaProductsCacheRef.current[selectedFamily.slug];
    if (cached?.length) {
      setMegaProductsLoading(false);
      return;
    }

    setMegaProductsLoading(true);
    loadFamilyProducts(selectedFamily).finally(() => {
      if (!cancelled) setMegaProductsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedFamily?._id, selectedFamily?.slug]);

  const accountHref =
    status === "authenticated"
      ? (session?.user as any)?.role === "admin"
        ? "/admin"
        : "/profile"
      : "/login";

  const megaProducts = selectedFamily
    ? megaProductsBySlug[selectedFamily.slug] ||
      megaProductsCacheRef.current[selectedFamily.slug] ||
      []
    : [];

  const openTab = (tab: MegaTab) => setActiveTab(tab);
  const closeMega = () => setActiveTab(null);

  return (
    <header
      className={cn(
        "fixed top-0 w-full z-50 transition-shadow duration-300",
        isScrolled || activeTab
          ? "shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
          : "",
      )}
    >
      {activeTab && (
        <button
          type="button"
          aria-label="Close menu"
          className="hidden lg:block fixed inset-0 z-40 bg-black/30 cursor-default"
          onClick={closeMega}
        />
      )}

      <div
        className="relative z-50"
        onMouseLeave={() => {
          if (typeof window !== "undefined" && window.innerWidth >= 1024) {
            closeMega();
          }
        }}
      >
      {/* Utility strip */}
      <div
        className={cn(
          "hidden lg:flex bg-white border-b border-foreground/8 px-6 xl:px-12 items-center justify-between text-[10px] uppercase tracking-[0.22em] font-bold transition-all duration-300 overflow-hidden",
          isScrolled ? "h-0 opacity-0 border-none" : "h-10 opacity-100",
        )}
      >
        <div className="flex items-center gap-6 text-foreground/70">
          <Link
            href="/contact"
            className="flex items-center gap-2 hover:text-foreground transition-colors"
          >
            <MapPin className="w-3.5 h-3.5 opacity-70" />
            Find a showroom
          </Link>
          <Link
            href="tel:02046342203"
            className="flex items-center gap-2 hover:text-foreground transition-colors"
          >
            <Phone className="w-3.5 h-3.5 opacity-70" />
            020 4634 2203
          </Link>
        </div>
        <div className="flex items-center gap-6 text-foreground/70">
          <Link href="/search" className="hover:text-foreground transition-colors">
            Product search
          </Link>
          <Link href="/new-arrivals" className="hover:text-foreground transition-colors">
            New in
          </Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">
            Contact us
          </Link>
        </div>
      </div>

      {/* Main bar */}
      <div className="bg-white border-b border-foreground/8 px-5 lg:px-8 xl:px-12">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4 h-14 md:h-14">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 hover:opacity-70 transition-opacity"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5 stroke-[1.5]" />
            </button>

            <Link href="/" className="shrink-0">
              <BrandLogo name={storeName} size="sm" />
            </Link>
          </div>

          <div className="hidden md:block flex-1 max-w-sm mx-4 lg:mx-8">
            <SearchBar />
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsSearchOpen((v) => !v)}
              className="md:hidden p-2 hover:opacity-70 transition-opacity"
              aria-label="Search"
            >
              <Search className="w-5 h-5 stroke-[1.5]" />
            </button>

            <Link
              href={accountHref}
              className="hidden sm:flex items-center gap-2 p-2 hover:opacity-70 transition-opacity"
            >
              <User className="w-5 h-5 stroke-[1.5]" />
              <span className="hidden xl:inline text-[10px] uppercase tracking-[0.2em] font-bold">
                {status === "authenticated" ? "Account" : "Log in"}
              </span>
            </Link>

            {status === "authenticated" && (
              <button
                type="button"
                onClick={() => setShowLogoutModal(true)}
                className="hidden lg:inline-flex px-3 py-2 text-[9px] uppercase tracking-[0.2em] font-bold border border-foreground/15 hover:border-foreground/40 transition-colors"
              >
                Log out
              </button>
            )}

            <button
              type="button"
              onClick={openWishlist}
              className="relative p-2 hover:opacity-70 transition-opacity"
              aria-label="Open wishlist"
            >
              <Heart className="w-5 h-5 stroke-[1.5]" />
              {mounted && wishlistItems.length > 0 && (
                <span className="absolute top-1 right-0.5 bg-primary text-primary-foreground text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                  {wishlistItems.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={openCart}
              className="relative p-2 hover:opacity-70 transition-opacity"
              aria-label="Open cart"
            >
              <ShoppingBag className="w-5 h-5 stroke-[1.5]" />
              {mounted && getTotalItems() > 0 && (
                <span className="absolute top-1 right-0.5 bg-primary text-primary-foreground text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                  {getTotalItems()}
                </span>
              )}
            </button>
          </div>
        </div>

        {isSearchOpen && (
          <div className="md:hidden pb-4">
            <SearchBar isMobile onClose={() => setIsSearchOpen(false)} />
          </div>
        )}
      </div>

      {/* Porcelanosa-style primary tabs + mega panels */}
      <div
        className="hidden lg:block bg-white border-b border-foreground/8 relative"
        onMouseLeave={closeMega}
      >
        <div className="max-w-[1600px] mx-auto px-8 xl:px-12">
          <nav
            className="flex items-center justify-center gap-2 xl:gap-4 min-h-[46px]"
            aria-busy={menusLoading}
          >
            <Link
              href="/"
              onMouseEnter={closeMega}
              className={cn(
                "inline-flex items-center px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors",
                pathname === "/" && !activeTab
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
            >
              Home
            </Link>
            <button
              type="button"
              onMouseEnter={() => openTab("brands")}
              onFocus={() => openTab("brands")}
              onClick={() =>
                setActiveTab((prev) => (prev === "brands" ? null : "brands"))
              }
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors",
                activeTab === "brands"
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
              aria-expanded={activeTab === "brands"}
            >
              Brands
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform duration-300",
                  activeTab === "brands" && "rotate-180",
                )}
              />
            </button>
            <button
              type="button"
              onMouseEnter={() => openTab("products")}
              onFocus={() => openTab("products")}
              onClick={() =>
                setActiveTab((prev) =>
                  prev === "products" ? null : "products",
                )
              }
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors",
                activeTab === "products"
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
              aria-expanded={activeTab === "products"}
            >
              Products
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform duration-300",
                  activeTab === "products" && "rotate-180",
                )}
              />
            </button>
            <button
              type="button"
              onMouseEnter={() => openTab("about")}
              onFocus={() => openTab("about")}
              onClick={() =>
                setActiveTab((prev) => (prev === "about" ? null : "about"))
              }
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors",
                activeTab === "about"
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
              aria-expanded={activeTab === "about"}
            >
              About
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform duration-300",
                  activeTab === "about" && "rotate-180",
                )}
              />
            </button>
            <Link
              href="/contact"
              onMouseEnter={closeMega}
              className={cn(
                "inline-flex items-center px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors",
                pathname === "/contact" && !activeTab
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
            >
              Contact Us
            </Link>
          </nav>
        </div>

        {/* Mega panel */}
        <div
          className={cn(
            "absolute left-0 right-0 top-full bg-white border-b border-foreground/10 shadow-[0_28px_70px_rgba(0,0,0,0.1)] transition-all duration-300",
            activeTab
              ? "opacity-100 visible translate-y-0"
              : "opacity-0 invisible -translate-y-1 pointer-events-none",
          )}
        >
          {/* BRANDS */}
          {activeTab === "brands" && (
            <div className="max-w-[1600px] mx-auto px-8 xl:px-12 py-8 min-h-[240px]">
              {menusLoading ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16">
                  <Loader2 className="w-7 h-7 animate-spin text-primary opacity-70" />
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-muted-foreground">
                    Loading brands…
                  </p>
                </div>
              ) : brandMenus.length === 0 ? (
                <p className="text-sm text-muted-foreground py-10 text-center">
                  No brands available yet.
                </p>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-end justify-between gap-4">
                    <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
                      Shop by brand
                    </p>
                    <Link
                      href="/category"
                      onClick={closeMega}
                      className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                    >
                      View all products
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {brandMenus.map((brand) => (
                      <Link
                        key={brand._id}
                        href={catalogueHref({ brand: brand.slug })}
                        onClick={closeMega}
                        className="group relative overflow-hidden border border-foreground/8 bg-secondary/30 min-h-[110px] hover:border-foreground/20 transition-colors"
                      >
                        {brand.image ? (
                          <Image
                            src={brand.image}
                            alt=""
                            fill
                            className="object-cover opacity-80 transition-transform duration-700 group-hover:scale-105"
                            sizes="240px"
                          />
                        ) : null}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
                        <div className="absolute inset-0 flex flex-col justify-end p-4">
                          <p className="font-serif text-base tracking-[0.08em] uppercase text-white">
                            {brand.name}
                          </p>
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/70 mt-1">
                            {(brand.menus || []).length} categor
                            {(brand.menus || []).length === 1 ? "y" : "ies"}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PRODUCTS — categories | 3 product cards */}
          {activeTab === "products" && (
            <div className="max-w-[1600px] mx-auto px-8 xl:px-12 py-5 grid grid-cols-12 gap-0 h-[380px]">
              {menusLoading ? (
                <div className="col-span-12 flex flex-col items-center justify-center gap-4 py-16">
                  <Loader2 className="w-7 h-7 animate-spin text-primary opacity-70" />
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-muted-foreground">
                    Loading products…
                  </p>
                </div>
              ) : allCategories.length === 0 ? (
                <div className="col-span-12 flex flex-col items-center justify-center gap-3 py-16">
                  <p className="text-sm text-muted-foreground">
                    No categories available yet.
                  </p>
                </div>
              ) : (
                <>
                  <aside className="col-span-4 border-r border-foreground/8 pr-5 flex flex-col min-h-0 h-full">
                    <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary mb-3 shrink-0">
                      Categories
                    </p>
                    <ul className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-0.5 pr-1">
                      {allCategories.map(({ family, brandName }) => {
                        const isActive = selectedFamily?._id === family._id;
                        return (
                          <li key={family._id}>
                            <button
                              type="button"
                              onMouseEnter={() =>
                                setActiveProductFamily(family._id)
                              }
                              onFocus={() =>
                                setActiveProductFamily(family._id)
                              }
                              onClick={() =>
                                setActiveProductFamily(family._id)
                              }
                              className={cn(
                                "w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-[12px] tracking-wide transition-colors",
                                isActive
                                  ? "bg-secondary text-foreground font-semibold"
                                  : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
                              )}
                            >
                              <span className="flex items-center gap-3 min-w-0">
                                {family.image ? (
                                  <span className="relative w-8 h-8 shrink-0 overflow-hidden bg-secondary">
                                    <Image
                                      src={family.image}
                                      alt=""
                                      fill
                                      className="object-contain p-0.5"
                                      sizes="32px"
                                    />
                                  </span>
                                ) : null}
                                <span className="min-w-0">
                                  <span className="block truncate">
                                    {family.name}
                                  </span>
                                  <span className="block text-[10px] text-foreground/40 truncate">
                                    {brandName}
                                  </span>
                                </span>
                              </span>
                              <ChevronRight
                                className={cn(
                                  "w-3.5 h-3.5 shrink-0 transition-opacity",
                                  isActive ? "opacity-80" : "opacity-30",
                                )}
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {selectedFamily && selectedCategory ? (
                      <div className="shrink-0 pt-3 mt-2 border-t border-foreground/8">
                        <Link
                          href={catalogueHref({
                            brand: selectedCategory.brandSlug,
                            category: selectedFamily.slug,
                          })}
                          onClick={closeMega}
                          className="inline-flex text-[10px] uppercase tracking-[0.25em] font-bold border-b border-foreground/25 pb-1 hover:border-primary hover:text-primary transition-colors"
                        >
                          Shop all {selectedFamily.name}
                        </Link>
                      </div>
                    ) : null}
                  </aside>

                  <div className="col-span-8 pl-6 xl:pl-10 py-1 h-full overflow-hidden">
                    {selectedFamily && selectedCategory ? (
                      <div className="h-full flex flex-col animate-in fade-in duration-300">
                        <div className="flex items-end justify-between gap-4 shrink-0 mb-4">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-bold mb-1">
                              Featured
                            </p>
                            <h3 className="font-serif text-xl tracking-[0.06em]">
                              {selectedFamily.name}
                            </h3>
                          </div>
                          <Link
                            href={catalogueHref({
                              brand: selectedCategory.brandSlug,
                              category: selectedFamily.slug,
                            })}
                            onClick={closeMega}
                            className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                          >
                            View all
                          </Link>
                        </div>

                        {megaProductsLoading && !megaProducts.length ? (
                          <div className="grid grid-cols-3 gap-4 flex-1 content-start">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="space-y-2 animate-pulse">
                                <div className="h-36 bg-secondary" />
                                <div className="h-3 bg-secondary w-3/4 mx-auto" />
                                <div className="h-3 bg-secondary w-1/2 mx-auto" />
                              </div>
                            ))}
                          </div>
                        ) : megaProducts.length > 0 ? (
                          <div className="grid grid-cols-3 gap-4 flex-1 content-start">
                            {megaProducts.slice(0, 3).map((product) => (
                              <Link
                                key={product._id}
                                href={`/products/${product._id}`}
                                className="group block space-y-2"
                                onClick={closeMega}
                              >
                                <div className="relative h-36 overflow-hidden bg-secondary">
                                  {getProductDisplayImage(product.images) ? (
                                    <Image
                                      src={getProductDisplayImage(
                                        product.images,
                                      )}
                                      alt={product.name}
                                      fill
                                      className="object-cover transition-transform duration-700 group-hover:scale-105"
                                      sizes="(max-width: 1280px) 22vw, 260px"
                                    />
                                  ) : null}
                                </div>
                                <div className="space-y-1 text-center px-1">
                                  <p
                                    className="text-[11px] uppercase tracking-[0.14em] leading-snug line-clamp-2 group-hover:text-primary transition-colors"
                                    title={product.name}
                                  >
                                    {product.name}
                                  </p>
                                  <p className="text-[12px] tracking-wide text-foreground font-semibold">
                                    £
                                    {Number(product.price).toLocaleString(
                                      "en-GB",
                                      {
                                        minimumFractionDigits: 2,
                                      },
                                    )}
                                  </p>
                                </div>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <div className="py-8 text-sm text-muted-foreground">
                            No products in this category yet.{" "}
                            <Link
                              href={catalogueHref({
                                brand: selectedCategory.brandSlug,
                                category: selectedFamily.slug,
                              })}
                              onClick={closeMega}
                              className="underline underline-offset-4 hover:text-primary"
                            >
                              Browse {selectedFamily.name}
                            </Link>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                        Select a category to preview products.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ABOUT */}
          {activeTab === "about" && (
            <div className="max-w-[1600px] mx-auto px-8 xl:px-12 py-10 grid grid-cols-12 gap-10 min-h-[280px]">
              <div className="col-span-4 space-y-4">
                <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
                  About
                </p>
                <h3 className="font-serif text-2xl md:text-3xl tracking-[0.08em] leading-tight">
                  {storeName}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
                  Luxury architectural materials and fixtures for refined living
                  — craftsmanship, specification support, and lasting finishes.
                </p>
              </div>
              <div className="col-span-8 grid grid-cols-2 gap-x-10 gap-y-1 content-start">
                {ABOUT_LINKS.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="group py-4 border-b border-foreground/6 hover:border-foreground/20 transition-colors"
                  >
                    <p className="text-[13px] font-medium tracking-wide group-hover:text-primary transition-colors">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {item.note}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-[100] lg:hidden transition-all duration-500",
          isMenuOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-500",
            isMenuOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setIsMenuOpen(false)}
        />

        <div
          className={cn(
            "absolute top-0 left-0 w-[88%] max-w-sm h-full bg-white shadow-2xl transition-transform duration-500 ease-out flex flex-col",
            isMenuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="px-6 py-5 border-b border-foreground/8 flex justify-between items-center">
            <BrandLogo name={storeName} size="sm" />
            <button type="button" onClick={() => setIsMenuOpen(false)}>
              <X className="w-6 h-6 stroke-1" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-5 border-b border-foreground/8">
              <SearchBar isMobile onClose={() => setIsMenuOpen(false)} />
            </div>

            {menusLoading ? (
              <div className="px-6 py-8 space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-3 w-2/3 bg-foreground/8 animate-pulse rounded-sm"
                  />
                ))}
                <span className="sr-only">Loading navigation</span>
              </div>
            ) : (
              <>
            <Link
              href="/"
              onClick={() => setIsMenuOpen(false)}
              className="block px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold border-b border-foreground/8"
            >
              Home
            </Link>

            <div className="border-b border-foreground/8">
              <button
                type="button"
                onClick={() =>
                  setMobileSection((s) => (s === "brands" ? null : "brands"))
                }
                className="w-full flex items-center justify-between px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold"
              >
                Brands
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform",
                    mobileSection === "brands" && "rotate-180",
                  )}
                />
              </button>
              {mobileSection === "brands" && (
                <div className="px-6 pb-5 space-y-2">
                  {brandMenus.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      No brands available yet.
                    </p>
                  ) : (
                    brandMenus.map((brand) => (
                      <Link
                        key={brand.slug}
                        href={catalogueHref({ brand: brand.slug })}
                        onClick={() => setIsMenuOpen(false)}
                        className="block text-sm text-foreground/80 py-1.5"
                      >
                        {brand.name}
                      </Link>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="border-b border-foreground/8">
              <button
                type="button"
                onClick={() =>
                  setMobileSection((s) =>
                    s === "products" ? null : "products",
                  )
                }
                className="w-full flex items-center justify-between px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold"
              >
                Products
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform",
                    mobileSection === "products" && "rotate-180",
                  )}
                />
              </button>
              {mobileSection === "products" && (
                <div className="px-6 pb-5 space-y-3">
                  {allCategories.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      No categories available yet.
                    </p>
                  ) : (
                    allCategories.map(({ family, brandSlug, brandName }) => (
                      <Link
                        key={family._id}
                        href={catalogueHref({
                          brand: brandSlug,
                          category: family.slug,
                        })}
                        onClick={() => setIsMenuOpen(false)}
                        className="block text-sm font-semibold tracking-wide"
                      >
                        {family.name}
                        <span className="ml-2 text-[10px] font-normal text-foreground/40 uppercase tracking-wider">
                          {brandName}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Projects — temporarily hidden
            <div className="border-b border-foreground/8">
              <button
                type="button"
                onClick={() =>
                  setMobileSection((s) => (s === "projects" ? null : "projects"))
                }
                className="w-full flex items-center justify-between px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold"
              >
                Projects
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform",
                    mobileSection === "projects" && "rotate-180",
                  )}
                />
              </button>
              {mobileSection === "projects" && (
                <div className="px-6 pb-5 space-y-3">
                  {PROJECT_LINKS.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setIsMenuOpen(false)}
                      className="block text-sm text-foreground/80"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            */}

            {/* About */}
            <div className="border-b border-foreground/8">
              <button
                type="button"
                onClick={() =>
                  setMobileSection((s) => (s === "about" ? null : "about"))
                }
                className="w-full flex items-center justify-between px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold"
              >
                About
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform",
                    mobileSection === "about" && "rotate-180",
                  )}
                />
              </button>
              {mobileSection === "about" && (
                <div className="px-6 pb-5 space-y-3">
                  {ABOUT_LINKS.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setIsMenuOpen(false)}
                      className="block text-sm text-foreground/80"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <Link
              href="/contact"
              onClick={() => setIsMenuOpen(false)}
              className="block px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold border-b border-foreground/8"
            >
              Contact Us
            </Link>
              </>
            )}

            <div className="px-6 py-6 space-y-4 bg-secondary/40">
              <Link
                href={accountHref}
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] font-bold"
              >
                <User className="w-4 h-4" />
                {status === "authenticated"
                  ? session?.user?.name || "Account"
                  : "Log in / Register"}
              </Link>
              {status === "authenticated" && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setShowLogoutModal(true);
                  }}
                  className="w-full bg-foreground text-background text-[11px] uppercase tracking-[0.2em] font-bold py-3"
                >
                  Log out
                </button>
              )}
            </div>
          </div>

          <div className="px-6 py-5 border-t border-foreground/8">
            <Link
              href="tel:02046342203"
              className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.18em]"
            >
              <Phone className="w-4 h-4" /> 020 4634 2203
            </Link>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => signOut()}
        title="Sign Out"
        isDangerous={true}
        message="Are you sure you wish to exit your current session? You will need to re-authenticate to access your private acquisitions."
        confirmLabel="Exit Session"
      />
    </header>
  );
}

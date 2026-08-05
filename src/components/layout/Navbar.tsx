"use client";

import Link from "next/link";
import Image from "next/image";
import { sanitizeDisplayImageUrl } from "@/lib/productImage";
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
import { SearchBar } from "./SearchBar";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { subscribeCatalogChange } from "@/lib/live-sync";

type MenuNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  children?: MenuNode[];
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

/**
 * Accessory ranges. These sit as ordinary categories under each brand
 * (FAKRO "Blinds & Accessories", Britmet "Panel Fixings", Sterlingbuild
 * "Flashings" …), so they are gathered here rather than stored separately.
 * Matched on the category slug only — matching sub-categories too dragged in
 * whole window ranges that merely happen to sell an accessory.
 */
const ACCESSORY_RX =
  /accessor|fixing|flashing|adhesive|grout|underlay|sealant|fastener|spare|trim/i;

/** Size buckets offered in the department mega panel. */
const MEGA_SIZES = [
  { label: "Small (e.g. 20cm x 20cm)", value: "200x200" },
  { label: "Medium (e.g. 45cm x 45cm)", value: "450x450" },
  { label: "Large (e.g. 60cm x 60cm)", value: "600x600" },
  { label: "Extra large (e.g. 60cm x 120cm)", value: "600x1200" },
];

/**
 * First usable image in a menu tree.
 *
 * No department record carries its own image, but their categories do
 * (Bathrooms 12/12, Tiles 5/5, Heating 5/5), so the promo card and the
 * quick-shop bars borrow the first one they can find rather than rendering
 * an empty grey box.
 */
function firstImageFrom(nodes: any[]): string {
  for (const node of nodes || []) {
    const own = sanitizeDisplayImageUrl(node?.image || "");
    if (own) return own;
    const fromChild = firstImageFrom(node?.children || []);
    if (fromChild) return fromChild;
  }
  return "";
}

/** One column of links inside a mega panel (Topps-style facet list). */
function MegaFacetColumn({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: { label: string; href: string }[];
  onNavigate?: () => void;
}) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground mb-3">
        {title}
      </h4>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={`${item.label}-${item.href}`}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className="text-[12.5px] text-foreground/75 hover:text-foreground hover:underline underline-offset-4 leading-snug"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ABOUT_LINKS = [
  { label: "Our world", href: "/contact", note: "Brand & craft" },
  { label: "Track your order", href: "/track-order", note: "Live status" },
  { label: "Buying guides", href: "/faq", note: "Expert advice" },
  { label: "Delivery & returns", href: "/shipping-returns", note: "Orders" },
  { label: "Privacy policy", href: "/privacy", note: "Legal" },
];

/** Catalogue deep-link with Department / Brand / Category filters pre-applied */
function catalogueHref(opts: {
  brand?: string | null;
  category?: string | null;
  department?: string | null;
}) {
  const params = new URLSearchParams();
  if (opts.department) params.set("department", opts.department);
  if (opts.brand) params.set("brand", opts.brand);
  if (opts.category) params.set("category", opts.category);
  const q = params.toString();
  return q ? `/category?${q}` : "/category";
}

type DepartmentNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  categories?: Array<{
    _id: string;
    name: string;
    slug: string;
    image?: string;
    children?: MenuNode[];
  }>;
};

export function Navbar({
  initialBrandMenus,
  initialDepartments,
  initialStoreName,
}: {
  initialBrandMenus?: BrandWithMenus[];
  initialDepartments?: DepartmentNode[];
  initialStoreName?: string;
}) {
  // Original navigation. A retail-style alternative (department tabs +
  // sub-category strip + filter columns) is parked in
  // components/layout/NavbarShop.tsx and is not wired in.
  return (
    <NavbarContent
      initialBrandMenus={initialBrandMenus}
      initialDepartments={initialDepartments}
      initialStoreName={initialStoreName}
    />
  );
}

function NavbarContent({
  initialBrandMenus,
  initialDepartments,
  initialStoreName,
}: {
  initialBrandMenus?: BrandWithMenus[];
  initialDepartments?: DepartmentNode[];
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
  const [departmentTrees, setDepartmentTrees] = useState<DepartmentNode[]>(
    initialDepartments?.length ? initialDepartments : [],
  );
  const [selectedDepartmentSlug, setSelectedDepartmentSlug] = useState<
    string | null
  >(initialDepartments?.[0]?.slug || null);
  // Brands panel mirrors Departments: names on the left, that brand's
  // categories on the right.
  const [selectedBrandSlug, setSelectedBrandSlug] = useState<string | null>(
    initialBrandMenus?.[0]?.slug || null,
  );
  const [menusLoading, setMenusLoading] = useState(
    !initialBrandMenus?.length,
  );
  const [activeTab, setActiveTab] = useState<MegaTab>(null);
  const [activeProductFamily, setActiveProductFamily] = useState<string | null>(
    null,
  );
  const [mobileSection, setMobileSection] = useState<MegaTab>(null);
  const brandMenusRef = useRef(brandMenus);
  brandMenusRef.current = brandMenus;
  const pathname = usePathname();

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
    // Do not prefetch every category's products here — one server action each.
    // Products mega loads on demand when the tab / category is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content-keyed
  }, [initialBrandMenus]);

  useEffect(() => {
    if (!initialDepartments?.length) return;
    setDepartmentTrees(initialDepartments);
    setSelectedDepartmentSlug((prev) => prev || initialDepartments[0]?.slug || null);
  }, [initialDepartments]);

  useEffect(() => {
    if (initialStoreName) {
      setStoreName(initialStoreName);
    } else {
      getStoreName().then((name) => setStoreName(name));
    }

    let cancelled = false;
    const hasInitial = Boolean(initialBrandMenus?.length);
    const hasInitialDepartments = Boolean(initialDepartments?.length);

    const refreshBrands = async () => {
      try {
        if (!brandMenusRef.current.length) {
          setMenusLoading(true);
        }

        const { getBrandMenuTrees } = await import("@/app/actions/admin");
        const result = await getBrandMenuTrees();
        if (cancelled) return;

        const next =
          result.success && result.brands?.length ? result.brands : [];
        setBrandMenus(next);
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

    const refreshDepartments = async () => {
      try {
        const { getDepartmentTrees } = await import(
          "@/app/actions/departments"
        );
        const result = await getDepartmentTrees();
        if (cancelled) return;
        if (result.success) {
          const next = result.departments || [];
          setDepartmentTrees(next);
          setSelectedDepartmentSlug((prev) => {
            if (prev && next.some((d: DepartmentNode) => d.slug === prev)) {
              return prev;
            }
            return next[0]?.slug || null;
          });
        }
      } catch {
        /* ignore */
      }
    };
    // Brands come from RSC; departments should too. Only fetch client-side as fallback.
    if (!hasInitialDepartments) {
      refreshDepartments();
    }

    let catalogDebounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeCatalogChange(() => {
      // Coalesce admin sync storms into one refresh
      if (catalogDebounce) clearTimeout(catalogDebounce);
      catalogDebounce = setTimeout(() => {
        if (cancelled) return;
        refreshBrands();
        refreshDepartments();
      }, 1500);
    }, ["brands", "menus", "products", "departments", "all"]);

    setMounted(true);
    const handleScroll = () => setIsScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handleScroll);
    return () => {
      cancelled = true;
      if (catalogDebounce) clearTimeout(catalogDebounce);
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


  // The Products mega no longer previews product cards — it lists brands and
  // their ranges — so nothing is prefetched here any more. Removing the fetch
  // also stops a network round-trip firing every time the menu is opened.

  const accountHref =
    status === "authenticated"
      ? (session?.user as any)?.role === "admin"
        ? "/admin"
        : "/profile"
      : "/login";

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
          "hidden lg:block bg-white border-b border-foreground/8 text-[10px] uppercase tracking-[0.22em] font-bold transition-all duration-300 overflow-hidden",
          isScrolled ? "h-0 opacity-0 border-none" : "h-10 opacity-100",
        )}
      >
        <div className="site-container h-full flex items-center justify-between">
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
          <Link
            href="/track-order"
            className="hover:text-foreground transition-colors"
          >
            Track order
          </Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">
            Contact us
          </Link>
        </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="bg-white border-b border-foreground/8">
        <div className="site-container flex items-center justify-between gap-2 sm:gap-4 h-14 md:h-14">
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              className="lg:hidden p-1.5 sm:p-2 hover:opacity-70 transition-opacity"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5 stroke-[1.5]" />
            </button>

            <Link href="/" className="min-w-0 shrink">
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
              className="md:hidden p-1.5 sm:p-2 hover:opacity-70 transition-opacity"
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
              className="relative p-1.5 sm:p-2 hover:opacity-70 transition-opacity"
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
              className="relative p-1.5 sm:p-2 hover:opacity-70 transition-opacity"
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
        <div className="site-container">
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
            {/* Topps-style flat tabs: each real department is its own top
                level item, and hovering opens that department's mega panel.
                No generic "Departments / Products" dropdowns. */}
            {departmentTrees.map((dept) => {
              const tab = `dept:${dept.slug}`;
              const isOpen = activeTab === tab;
              return (
                <button
                  key={dept._id}
                  type="button"
                  onMouseEnter={() => openTab(tab)}
                  onFocus={() => openTab(tab)}
                  onClick={() =>
                    setActiveTab((prev) => (prev === tab ? null : tab))
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors whitespace-nowrap",
                    isOpen
                      ? "text-foreground border-foreground"
                      : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
                  )}
                  aria-expanded={isOpen}
                >
                  {dept.name}
                </button>
              );
            })}
            <button
              type="button"
              onMouseEnter={() => openTab("accessories")}
              onFocus={() => openTab("accessories")}
              onClick={() =>
                setActiveTab((prev) =>
                  prev === "accessories" ? null : "accessories",
                )
              }
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors whitespace-nowrap",
                activeTab === "accessories"
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
              aria-expanded={activeTab === "accessories"}
            >
              Accessories
            </button>
            <button
              type="button"
              onMouseEnter={() => openTab("brands")}
              onFocus={() => openTab("brands")}
              onClick={() =>
                setActiveTab((prev) => (prev === "brands" ? null : "brands"))
              }
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors whitespace-nowrap",
                activeTab === "brands"
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
              aria-expanded={activeTab === "brands"}
            >
              Brands
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
            {/* Configurator is now built into each product page (the area /
                price calculator in the buy box), so it no longer needs its own
                menu entry. Routes still exist — restore this link to bring the
                standalone section back. */}
            {/* <Link
              href="/configurator"
              onMouseEnter={closeMega}
              className={cn(
                "inline-flex items-center px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors",
                pathname?.startsWith("/configurator") && !activeTab
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
            >
              Configurator
            </Link> */}
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
          {/* DEPARTMENT MEGA — Topps layout: facet columns + promo card,
              with quick-shop bars beneath. Driven entirely by our own data. */}
          {activeTab?.startsWith("dept:") &&
            (() => {
              const slug = activeTab.slice(5);
              const dept = departmentTrees.find((d) => d.slug === slug);
              if (!dept) return null;
              // Accessory ranges have their own tab now, so they are kept out
              // of the department columns to stop fixings and flashings
              // crowding out the products people came for.
              const cats = (dept.categories || []).filter(
                (c) => !ACCESSORY_RX.test(`${c.slug} ${c.name}`),
              );
              const types = cats
                .flatMap((c) =>
                  (c.children || []).map((k) => ({ cat: c, child: k })),
                )
                .slice(0, 9);
              const catSlugs = new Set(cats.map((c) => c.slug));
              const deptBrands = brandMenus.filter((b) =>
                (b.menus || []).some((m) => catSlugs.has(m.slug)),
              );
              const brandsToShow = (deptBrands.length ? deptBrands : brandMenus).slice(0, 9);
              const cover =
                sanitizeDisplayImageUrl(dept.image || "") ||
                firstImageFrom(cats);

              return (
                <div className="site-container py-8">
                  <div className="grid grid-cols-12 gap-8">
                    <div className="col-span-2">
                      <MegaFacetColumn
                        title="Category"
                        items={cats.slice(0, 9).map((c) => ({
                          label: c.name,
                          href: catalogueHref({
                            department: dept.slug,
                            category: c.slug,
                          }),
                        }))}
                        onNavigate={closeMega}
                      />
                    </div>
                    <div className="col-span-2">
                      <MegaFacetColumn
                        title="Type"
                        items={types.map(({ cat, child }) => ({
                          label: child.name,
                          href: `${catalogueHref({
                            department: dept.slug,
                            category: cat.slug,
                          })}&subcategory=${encodeURIComponent(child.slug)}`,
                        }))}
                        onNavigate={closeMega}
                      />
                    </div>
                    <div className="col-span-2">
                      <MegaFacetColumn
                        title="Size"
                        items={MEGA_SIZES.map((z) => ({
                          label: z.label,
                          href: `${catalogueHref({
                            department: dept.slug,
                          })}&size=${encodeURIComponent(z.value)}`,
                        }))}
                        onNavigate={closeMega}
                      />
                    </div>
                    <div className="col-span-3">
                      <MegaFacetColumn
                        title="Our Brands"
                        items={brandsToShow.map((b) => ({
                          label: b.name,
                          href: catalogueHref({
                            department: dept.slug,
                            brand: b.slug,
                          }),
                        }))}
                        onNavigate={closeMega}
                      />
                    </div>

                    {/* Promo card */}
                    <div className="col-span-3">
                      <div className="bg-secondary/40 p-4">
                        <div className="relative aspect-[4/3] bg-secondary overflow-hidden mb-3">
                          {cover ? (
                            <Image
                              src={cover}
                              alt=""
                              fill
                              sizes="280px"
                              className="object-cover"
                            />
                          ) : null}
                        </div>
                        <p className="text-sm font-bold">{dept.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                          Browse the full {dept.name.toLowerCase()} range from
                          every brand we stock.
                        </p>
                        <Link
                          href={catalogueHref({ department: dept.slug })}
                          onClick={closeMega}
                          className="mt-2 inline-block text-xs font-bold underline underline-offset-4"
                        >
                          Shop Now
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Quick-shop bars, as in the reference design */}
                  {cats.length > 0 && (
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[...cats]
                        .sort(
                          (a, b) =>
                            (firstImageFrom([b]) ? 1 : 0) -
                            (firstImageFrom([a]) ? 1 : 0),
                        )
                        .slice(0, 2)
                        .map((c) => (
                        <Link
                          key={c._id}
                          href={catalogueHref({
                            department: dept.slug,
                            category: c.slug,
                          })}
                          onClick={closeMega}
                          className="flex items-center gap-4 bg-secondary/40 hover:bg-secondary px-5 py-4 transition-colors"
                        >
                          <span className="relative w-12 h-12 bg-secondary overflow-hidden shrink-0">
                            {firstImageFrom([c]) ? (
                              <Image
                                src={firstImageFrom([c])}
                                alt=""
                                fill
                                sizes="48px"
                                className="object-cover"
                              />
                            ) : null}
                          </span>
                          <span className="text-[15px] font-semibold">
                            Shop {c.name}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

          {/* ACCESSORIES — every brand's accessory ranges in one place, so
              fixings and flashings are findable without hunting through the
              department a window happens to sit in. */}
          {activeTab === "accessories" &&
            (() => {
              const groups = brandMenus
                .map((brand) => ({
                  brand,
                  menus: (brand.menus || []).filter((m) =>
                    ACCESSORY_RX.test(`${m.slug} ${m.name}`),
                  ),
                }))
                .filter((g) => g.menus.length > 0);

              if (!groups.length) {
                return (
                  <div className="site-container py-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      No accessory ranges available yet.
                    </p>
                  </div>
                );
              }

              return (
                <div className="site-container py-8 max-h-[calc(100vh-200px)] overflow-y-auto custom-scrollbar">
                  <div className="flex items-end justify-between gap-4 mb-5">
                    <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
                      Accessories by brand
                    </p>
                    <Link
                      href="/category"
                      onClick={closeMega}
                      className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                    >
                      View all products
                    </Link>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-6">
                    {groups.map(({ brand, menus }) => (
                      <div key={brand._id}>
                        <Link
                          href={catalogueHref({ brand: brand.slug })}
                          onClick={closeMega}
                          className="block text-[10.5px] uppercase tracking-[0.16em] font-bold mb-2 hover:text-primary transition-colors"
                        >
                          {brand.name}
                        </Link>
                        <ul className="space-y-1.5">
                          {menus.map((menu) => (
                            <li key={menu._id}>
                              <Link
                                href={catalogueHref({
                                  brand: brand.slug,
                                  category: menu.slug,
                                })}
                                onClick={closeMega}
                                className="text-[12px] text-foreground/75 hover:text-foreground hover:underline underline-offset-4 leading-snug"
                              >
                                {menu.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          {/* BRANDS — same two-pane shape as Departments: brand names on
              the left, that brand's own categories on the right. */}
          {activeTab === "brands" && (
            <div className="site-container py-5 grid grid-cols-12 gap-0 h-[380px]">
              {menusLoading ? (
                <div className="col-span-12 flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-7 h-7 animate-spin text-primary opacity-70" />
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-muted-foreground">
                    Loading brands…
                  </p>
                </div>
              ) : brandMenus.length === 0 ? (
                <div className="col-span-12 flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    No brands available yet.
                  </p>
                </div>
              ) : (
                <>
                  <aside className="col-span-4 border-r border-foreground/8 pr-5 flex flex-col min-h-0 h-full">
                    <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary mb-3 shrink-0">
                      Shop by brand
                    </p>
                    <ul className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-0.5 pr-1">
                      {brandMenus.map((brand) => {
                        const isActive =
                          (selectedBrandSlug || brandMenus[0]?.slug) ===
                          brand.slug;
                        return (
                          <li key={brand._id}>
                            <button
                              type="button"
                              onMouseEnter={() => setSelectedBrandSlug(brand.slug)}
                              onFocus={() => setSelectedBrandSlug(brand.slug)}
                              onClick={() => setSelectedBrandSlug(brand.slug)}
                              className={cn(
                                "w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-[12px] tracking-wide transition-colors",
                                isActive
                                  ? "bg-secondary text-foreground font-semibold"
                                  : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
                              )}
                            >
                              <span className="truncate uppercase tracking-[0.08em]">
                                {brand.name}
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
                  </aside>

                  <div className="col-span-8 pl-6 xl:pl-10 py-1 h-full overflow-hidden">
                    {(() => {
                      const selected =
                        brandMenus.find((b) => b.slug === selectedBrandSlug) ||
                        brandMenus[0];
                      if (!selected) return null;
                      const cats = selected.menus || [];
                      return (
                        <div className="h-full flex flex-col animate-in fade-in duration-300">
                          <div className="flex items-end justify-between gap-4 shrink-0 mb-4">
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-bold mb-1">
                                Categories
                              </p>
                              <h3 className="font-serif text-xl tracking-[0.06em] uppercase">
                                {selected.name}
                              </h3>
                            </div>
                            <Link
                              href={catalogueHref({ brand: selected.slug })}
                              onClick={closeMega}
                              className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                            >
                              View all
                            </Link>
                          </div>

                          {cats.length > 0 ? (
                            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 content-start">
                                {cats.map((cat) => (
                                  <Link
                                    key={cat._id}
                                    href={catalogueHref({
                                      brand: selected.slug,
                                      category: cat.slug,
                                    })}
                                    onClick={closeMega}
                                    className="px-3 py-3 border border-foreground/8 hover:border-foreground/20 text-[12px] tracking-wide transition-colors"
                                  >
                                    {cat.name}
                                    {(cat.children || []).length > 0 ? (
                                      <span className="block text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
                                        {(cat.children || []).length} types
                                      </span>
                                    ) : null}
                                  </Link>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="flex-1 flex items-start">
                              <Link
                                href={catalogueHref({ brand: selected.slug })}
                                onClick={closeMega}
                                className="inline-flex text-[12px] uppercase tracking-[0.16em] font-bold border-b border-foreground/30 pb-1 hover:border-foreground"
                              >
                                Shop {selected.name}
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          {/* PRODUCTS — one column per brand, listing that brand's own
              ranges. Organised around the brands we actually stock rather
              than a flat category list, so a customer picks the maker first
              and lands straight on that maker's products. */}
          {activeTab === "products" && (
            /* Capped to the space below the header so the panel never runs off
               the bottom of the screen — it scrolls inside instead. */
            <div className="site-container py-6 max-h-[calc(100vh-200px)] overflow-y-auto custom-scrollbar">
              {menusLoading ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16">
                  <Loader2 className="w-7 h-7 animate-spin text-primary opacity-70" />
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-muted-foreground">
                    Loading products…
                  </p>
                </div>
              ) : brandMenus.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <p className="text-sm text-muted-foreground">
                    No products available yet.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-4 mb-5">
                    <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
                      Shop by brand &amp; range
                    </p>
                    <Link
                      href="/category"
                      onClick={closeMega}
                      className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                    >
                      View all products
                    </Link>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-6 gap-y-6">
                    {brandMenus.map((brand) => (
                      <div key={brand._id}>
                        <Link
                          href={catalogueHref({ brand: brand.slug })}
                          onClick={closeMega}
                          className="block text-[10.5px] uppercase tracking-[0.16em] font-bold mb-2 hover:text-primary transition-colors"
                        >
                          {brand.name}
                        </Link>
                        <ul className="space-y-1.5">
                          {(brand.menus || []).slice(0, 5).map((menu) => (
                            <li key={menu._id}>
                              <Link
                                href={catalogueHref({
                                  brand: brand.slug,
                                  category: menu.slug,
                                })}
                                onClick={closeMega}
                                className="text-[12px] text-foreground/75 hover:text-foreground hover:underline underline-offset-4 leading-snug"
                              >
                                {menu.name}
                              </Link>
                            </li>
                          ))}
                          {(brand.menus || []).length > 5 && (
                            <li>
                              <Link
                                href={catalogueHref({ brand: brand.slug })}
                                onClick={closeMega}
                                className="text-[11px] font-bold underline underline-offset-4"
                              >
                                View all
                              </Link>
                            </li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>

                  {/* Quick entry points, mirroring the "Shop …" bars in the
                      reference designs. */}
                  <div className="mt-7 pt-5 border-t border-foreground/10 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Shop all tiles", href: catalogueHref({ department: "tiles" }) },
                      { label: "Shop all flooring", href: catalogueHref({ department: "flooring" }) },
                      { label: "New arrivals", href: "/new-arrivals" },
                    ].map((q) => (
                      <Link
                        key={q.href}
                        href={q.href}
                        onClick={closeMega}
                        className="px-4 py-3 bg-secondary/50 hover:bg-secondary text-[12px] uppercase tracking-[0.14em] font-bold transition-colors"
                      >
                        {q.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ABOUT */}
          {activeTab === "about" && (
            <div className="site-container py-10 grid grid-cols-12 gap-10 min-h-[280px]">
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
                  setMobileSection((s) =>
                    s === "departments" ? null : "departments",
                  )
                }
                className="w-full flex items-center justify-between px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold"
              >
                Departments
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform",
                    mobileSection === "departments" && "rotate-180",
                  )}
                />
              </button>
              {mobileSection === "departments" && (
                <div className="px-6 pb-5 space-y-2">
                  {departmentTrees.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      No departments yet.
                    </p>
                  ) : (
                    departmentTrees.map((dept) => (
                      <Link
                        key={dept.slug}
                        href={catalogueHref({ department: dept.slug })}
                        onClick={() => setIsMenuOpen(false)}
                        className="block text-sm text-foreground/80 py-1.5"
                      >
                        {dept.name}
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

            {/* Mobile counterpart of the desktop Configurator link — see note
                above; the calculator now lives on the product page. */}
            {/* <Link
              href="/configurator"
              onClick={() => setIsMenuOpen(false)}
              className="block px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold border-b border-foreground/8"
            >
              Configurator
            </Link> */}

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

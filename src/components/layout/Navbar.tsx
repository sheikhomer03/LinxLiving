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
import { useWishlistStore } from "@/store/useWishlistStore";
import { useSession, signOut, SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";
import ConfirmationModal from "@/components/common/ConfirmationModal";
import { getStoreName } from "@/app/actions/settings";
import { getPublicProducts } from "@/app/actions/products";
import { SearchBar } from "./SearchBar";

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

type MegaTab = "products" | "projects" | "about" | null;

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

function itemHref(slug: string) {
  if (
    ["new-arrivals", "custom", "contact", "faq", "search", "shipping-returns", "privacy", "terms"].includes(
      slug,
    )
  ) {
    return `/${slug}`;
  }
  return `/category/${slug}`;
}

export function Navbar() {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <NavbarContent />
    </SessionProvider>
  );
}

function NavbarContent() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { getTotalItems } = useCartStore();
  const { items: wishlistItems } = useWishlistStore();
  const [mounted, setMounted] = useState(false);
  const { data: session, status } = useSession();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [storeName, setStoreName] = useState("Linx Living");
  const [menuTree, setMenuTree] = useState<MenuNode[]>([]);
  const [menusLoading, setMenusLoading] = useState(true);
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
  const pathname = usePathname();

  useEffect(() => {
    getStoreName().then((name) => setStoreName(name));

    const fetchMenus = async () => {
      setMenusLoading(true);
      try {
        const { getMenuTree } = await import("@/app/actions/admin");
        const result = await getMenuTree();
        setMenuTree(result.success && result.tree?.length ? result.tree : []);
      } catch {
        setMenuTree([]);
      } finally {
        setMenusLoading(false);
      }
    };
    fetchMenus();

    setMounted(true);
    const handleScroll = () => setIsScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setIsMenuOpen(false);
    setActiveTab(null);
    setIsSearchOpen(false);
    setMobileSection(null);
  }, [pathname]);

  const productFamilies = menuTree;

  useEffect(() => {
    if (activeTab === "products" && productFamilies[0]) {
      setActiveProductFamily((prev) => {
        const stillValid = productFamilies.some((f) => f._id === prev);
        return stillValid && prev ? prev : productFamilies[0]._id;
      });
    }
  }, [activeTab, menuTree]);

  const selectedFamily =
    productFamilies.find((f) => f._id === activeProductFamily) ||
    productFamilies[0] ||
    null;

  useEffect(() => {
    if (activeTab !== "products" || !selectedFamily?.slug) return;

    const cacheKey = selectedFamily.slug;
    if (megaProductsCacheRef.current[cacheKey]) {
      setMegaProductsLoading(false);
      setMegaProductsBySlug((prev) =>
        prev[cacheKey]
          ? prev
          : { ...prev, [cacheKey]: megaProductsCacheRef.current[cacheKey] },
      );
      return;
    }

    let cancelled = false;
    setMegaProductsLoading(true);

    const categoryKeys = [
      selectedFamily.slug,
      selectedFamily.name,
      ...(selectedFamily.children || []).flatMap((c) => [c.slug, c.name]),
    ].filter(Boolean);

    getPublicProducts({
      category: categoryKeys,
      limit: 3,
      sort: "newest",
      fields: "name price images category",
    })
      .then((result) => {
        if (cancelled) return;
        const products = (result.products || []) as MegaProduct[];
        megaProductsCacheRef.current[cacheKey] = products;
        setMegaProductsBySlug((prev) => ({
          ...prev,
          [cacheKey]: products,
        }));
      })
      .finally(() => {
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
    ? megaProductsBySlug[selectedFamily.slug] || []
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
          onMouseEnter={closeMega}
          onClick={closeMega}
        />
      )}

      <div className="relative z-50">
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
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4 h-16 md:h-[4.5rem]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 hover:opacity-70 transition-opacity"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6 stroke-[1.5]" />
            </button>

            <Link href="/" className="shrink-0">
              <div className="relative w-28 sm:w-36 md:w-40 h-9 md:h-11">
                <img
                  src="/logo.png"
                  alt={storeName}
                  className="w-full h-full object-contain object-left"
                />
              </div>
            </Link>
          </div>

          <div className="hidden md:block flex-1 max-w-md mx-6 lg:mx-10">
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

            <Link href="/wishlist" className="relative p-2 hover:opacity-70 transition-opacity">
              <Heart className="w-5 h-5 stroke-[1.5]" />
              {mounted && wishlistItems.length > 0 && (
                <span className="absolute top-1 right-0.5 bg-primary text-primary-foreground text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                  {wishlistItems.length}
                </span>
              )}
            </Link>

            <Link href="/cart" className="relative p-2 hover:opacity-70 transition-opacity">
              <ShoppingBag className="w-5 h-5 stroke-[1.5]" />
              {mounted && getTotalItems() > 0 && (
                <span className="absolute top-1 right-0.5 bg-primary text-primary-foreground text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                  {getTotalItems()}
                </span>
              )}
            </Link>
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
          <nav className="flex items-center justify-center gap-2 xl:gap-4">
            <Link
              href="/"
              onMouseEnter={closeMega}
              className={cn(
                "inline-flex items-center px-4 py-4 text-[11px] uppercase tracking-[0.2em] font-bold border-b-2 transition-colors",
                pathname === "/" && !activeTab
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
            >
              Home
            </Link>
            {(
              [
                { id: "products", label: "Services" },
                // { id: "projects", label: "Projects" },
                { id: "about", label: "About" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onMouseEnter={() => openTab(tab.id)}
                onFocus={() => openTab(tab.id)}
                onClick={() =>
                  setActiveTab((prev) => (prev === tab.id ? null : tab.id))
                }
                className={cn(
                  "inline-flex items-center gap-1.5 px-4 py-4 text-[11px] uppercase tracking-[0.2em] font-bold border-b-2 transition-colors",
                  activeTab === tab.id
                    ? "text-foreground border-foreground"
                    : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
                )}
                aria-expanded={activeTab === tab.id}
              >
                {tab.label}
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 transition-transform duration-300",
                    activeTab === tab.id && "rotate-180",
                  )}
                />
              </button>
            ))}
            <Link
              href="/contact"
              onMouseEnter={closeMega}
              className={cn(
                "inline-flex items-center px-4 py-4 text-[11px] uppercase tracking-[0.2em] font-bold border-b-2 transition-colors",
                pathname === "/contact" && !activeTab
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
            >
              Contact Us
            </Link>
          </nav>
        </div>

        {/* Mega panel backdrop / panel */}
        <div
          className={cn(
            "absolute left-0 right-0 top-full bg-white border-b border-foreground/10 shadow-[0_28px_70px_rgba(0,0,0,0.1)] transition-all duration-300",
            activeTab
              ? "opacity-100 visible translate-y-0"
              : "opacity-0 invisible -translate-y-1 pointer-events-none",
          )}
        >
          {/* PRODUCTS — left families + right children (Porcelanosa pattern) */}
          {activeTab === "products" && (
            <div className="max-w-[1600px] mx-auto px-8 xl:px-12 py-8 grid grid-cols-12 gap-0 min-h-[340px]">
              {menusLoading ? (
                <div className="col-span-12 flex flex-col items-center justify-center gap-4 py-16">
                  <Loader2 className="w-7 h-7 animate-spin text-primary opacity-70" />
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-muted-foreground">
                    Loading services…
                  </p>
                </div>
              ) : productFamilies.length === 0 ? (
                <div className="col-span-12 flex flex-col items-center justify-center gap-3 py-16">
                  <p className="text-sm text-muted-foreground">
                    No services available yet.
                  </p>
                </div>
              ) : (
                <>
              <aside className="col-span-4 xl:col-span-3 border-r border-foreground/8 pr-6">
                <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary mb-4">
                  Services
                </p>
                <ul className="space-y-0.5">
                  {productFamilies.map((family) => {
                    const isActive = selectedFamily?._id === family._id;
                    return (
                      <li key={family._id}>
                        <button
                          type="button"
                          onMouseEnter={() => setActiveProductFamily(family._id)}
                          onFocus={() => setActiveProductFamily(family._id)}
                          className={cn(
                            "w-full flex items-center justify-between gap-3 px-3 py-3 text-left text-[12px] tracking-wide transition-colors",
                            isActive
                              ? "bg-secondary text-foreground font-semibold"
                              : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
                          )}
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            {family.image ? (
                              <span className="relative w-9 h-9 shrink-0 overflow-hidden bg-secondary">
                                <Image
                                  src={family.image}
                                  alt=""
                                  fill
                                  className="object-contain p-0.5"
                                  sizes="36px"
                                />
                              </span>
                            ) : null}
                            <span className="truncate">{family.name}</span>
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
                <Link
                  href="/new-arrivals"
                  className="inline-flex mt-6 text-[10px] uppercase tracking-[0.25em] font-bold border-b border-foreground/25 pb-1 hover:border-primary hover:text-primary transition-colors"
                >
                  View all services
                </Link>
              </aside>

              <div className="col-span-8 xl:col-span-9 pl-8 xl:pl-12 py-1">
                {selectedFamily ? (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-bold mb-2">
                          Collection
                        </p>
                        <h3 className="font-serif text-2xl tracking-[0.08em]">
                          {selectedFamily.name}
                        </h3>
                      </div>
                      <Link
                        href={itemHref(selectedFamily.slug)}
                        className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                      >
                        Shop all
                      </Link>
                    </div>

                    {(selectedFamily.children?.length || 0) > 0 && (
                      <div className="flex flex-wrap gap-x-6 gap-y-2 pb-1 border-b border-foreground/6">
                        {selectedFamily.children!.map((child) => (
                          <Link
                            key={child._id}
                            href={itemHref(child.slug)}
                            className="text-[11px] text-foreground/65 hover:text-primary transition-colors"
                          >
                            {child.name}
                          </Link>
                        ))}
                      </div>
                    )}

                    {megaProductsLoading && !megaProducts.length ? (
                      <div className="grid grid-cols-3 gap-5">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="space-y-3 animate-pulse">
                            <div className="aspect-[4/3] bg-secondary" />
                            <div className="h-3 bg-secondary w-3/4 mx-auto" />
                            <div className="h-3 bg-secondary w-1/2 mx-auto" />
                          </div>
                        ))}
                      </div>
                    ) : megaProducts.length > 0 ? (
                      <div className="grid grid-cols-3 gap-5">
                        {megaProducts.slice(0, 3).map((product) => (
                          <Link
                            key={product._id}
                            href={`/products/${product._id}`}
                            className="group block space-y-3"
                            onClick={closeMega}
                          >
                            <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
                              {product.images?.[0] ? (
                                <Image
                                  src={product.images[0]}
                                  alt={product.name}
                                  fill
                                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                                  sizes="(max-width: 1280px) 22vw, 280px"
                                />
                              ) : null}
                            </div>
                            <div className="space-y-1.5 text-center px-1">
                              <p
                                className="text-[11px] uppercase tracking-[0.14em] leading-snug line-clamp-2 group-hover:text-primary transition-colors"
                                title={product.name}
                              >
                                {product.name}
                              </p>
                              <p className="text-[12px] tracking-wide text-primary font-bold">
                                £
                                {Number(product.price).toLocaleString("en-GB", {
                                  minimumFractionDigits: 2,
                                })}
                              </p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    ) : selectedFamily.image ? (
                      <Link
                        href={itemHref(selectedFamily.slug)}
                        className="group relative block aspect-[21/9] overflow-hidden bg-secondary"
                        onClick={closeMega}
                      >
                        <Image
                          src={selectedFamily.image}
                          alt={selectedFamily.name}
                          fill
                          className="object-contain bg-secondary transition-transform duration-700 group-hover:scale-105"
                          sizes="(max-width: 1280px) 60vw, 800px"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                        <span className="absolute bottom-5 left-5 text-[10px] uppercase tracking-[0.25em] font-bold text-white">
                          Shop {selectedFamily.name}
                        </span>
                      </Link>
                    ) : (
                      <div className="py-10 text-sm text-muted-foreground">
                        Browse the full{" "}
                        <Link
                          href={itemHref(selectedFamily.slug)}
                          className="underline underline-offset-4 hover:text-primary"
                        >
                          {selectedFamily.name}
                        </Link>{" "}
                        range.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
                </>
              )}
            </div>
          )}

          {/* PROJECTS — temporarily hidden
          {activeTab === "projects" && (
            <div className="max-w-[1600px] mx-auto px-8 xl:px-12 py-10 grid grid-cols-12 gap-10 min-h-[280px]">
              <div className="col-span-4 space-y-4">
                <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
                  Projects
                </p>
                <h3 className="font-serif text-2xl md:text-3xl tracking-[0.08em] leading-tight">
                  Architecture & interiors
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
                  Discover how our materials are specified across homes,
                  hospitality, and commercial spaces.
                </p>
                <Link
                  href="/contact"
                  className="inline-flex text-[10px] uppercase tracking-[0.25em] font-bold border-b border-foreground/25 pb-1 hover:border-primary hover:text-primary transition-colors"
                >
                  Discuss a project
                </Link>
              </div>
              <div className="col-span-8 grid grid-cols-2 gap-x-10 gap-y-1 content-start">
                {PROJECT_LINKS.map((item) => (
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
          */}

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
            <div className="relative w-28 h-9">
              <img
                src="/logo.png"
                alt={storeName}
                className="w-full h-full object-contain object-left"
              />
            </div>
            <button type="button" onClick={() => setIsMenuOpen(false)}>
              <X className="w-6 h-6 stroke-1" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-5 border-b border-foreground/8">
              <SearchBar isMobile onClose={() => setIsMenuOpen(false)} />
            </div>

            <Link
              href="/"
              onClick={() => setIsMenuOpen(false)}
              className="block px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold border-b border-foreground/8"
            >
              Home
            </Link>

            {/* Products accordion */}
            <div className="border-b border-foreground/8">
              <button
                type="button"
                onClick={() =>
                  setMobileSection((s) => (s === "products" ? null : "products"))
                }
                className="w-full flex items-center justify-between px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold"
              >
                Services
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform",
                    mobileSection === "products" && "rotate-180",
                  )}
                />
              </button>
              {mobileSection === "products" && (
                <div className="px-6 pb-5 space-y-4">
                  {menusLoading ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary opacity-70" />
                      <p className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground">
                        Loading services…
                      </p>
                    </div>
                  ) : productFamilies.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      No services available yet.
                    </p>
                  ) : (
                    productFamilies.map((family) => (
                      <div key={family._id} className="space-y-2">
                        <Link
                          href={itemHref(family.slug)}
                          onClick={() => setIsMenuOpen(false)}
                          className="block text-sm font-semibold tracking-wide"
                        >
                          {family.name}
                        </Link>
                        {(family.children || []).map((child) => (
                          <Link
                            key={child._id}
                            href={itemHref(child.slug)}
                            onClick={() => setIsMenuOpen(false)}
                            className="block pl-3 text-xs text-foreground/65"
                          >
                            {child.name}
                          </Link>
                        ))}
                      </div>
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

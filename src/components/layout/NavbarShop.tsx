"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Heart,
  Menu,
  Search,
  ShoppingBag,
  Truck,
  User,
  X,
} from "lucide-react";
import { useSafeSession } from "@/hooks/useSafeSession";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useWishlistDrawerStore } from "@/store/useWishlistDrawerStore";
import { SearchBar } from "./SearchBar";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { sanitizeDisplayImageUrl } from "@/lib/productImage";

type MenuNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  children?: MenuNode[];
};

type DepartmentNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  categories?: MenuNode[];
};

type BrandWithMenus = {
  _id: string;
  name: string;
  slug: string;
  order: number;
  image?: string;
  menus: MenuNode[];
};

/** Catalogue deep-link — every menu item drives the real product filters. */
function catalogueHref(opts: {
  department?: string | null;
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;
  size?: string | null;
  material?: string | null;
  colour?: string | null;
  finish?: string | null;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts)) {
    if (value) params.set(key, String(value));
  }
  const q = params.toString();
  return q ? `/category?${q}` : "/category";
}

/** Size buckets offered in the mega panel, mirroring the catalogue filter. */
const SIZE_FACETS = [
  { label: "Small (e.g. 20cm x 20cm)", value: "200x200" },
  { label: "Medium (e.g. 45cm x 45cm)", value: "450x450" },
  { label: "Large (e.g. 60cm x 60cm)", value: "600x600" },
  { label: "Extra large (e.g. 60cm x 120cm)", value: "600x1200" },
];

const FINISH_FACETS = ["Gloss", "High Gloss", "Matt", "Matt Carving", "Outdoor"];

const MATERIAL_FACETS = [
  "Ceramic",
  "Porcelain",
  "Marble",
  "Natural Stone",
  "Vinyl",
  "Laminate",
];

const UTILITY_LINKS = [
  { label: "Ideas & Inspiration", href: "/faq" },
  { label: "Delivery & Returns", href: "/shipping-returns" },
  { label: "Help Centre", href: "/contact" },
];

export function NavbarShop({
  initialBrandMenus,
  initialDepartments,
  initialStoreName,
}: {
  initialBrandMenus?: BrandWithMenus[];
  initialDepartments?: DepartmentNode[];
  initialStoreName?: string;
}) {
  const pathname = usePathname();
  const { data: session } = useSafeSession();
  const [mounted, setMounted] = useState(false);
  const [openDept, setOpenDept] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileDept, setMobileDept] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getTotalItems = useCartStore((s) => s.getTotalItems);
  const openCart = useCartDrawerStore((s) => s.open);
  const openWishlist = useWishlistDrawerStore((s) => s.open);
  const wishlistItems = useWishlistStore((s) => s.items);

  const storeName = initialStoreName || "Linx Square";
  const departments = useMemo(
    () => (initialDepartments || []).filter((d) => (d.categories || []).length),
    [initialDepartments],
  );
  const brands = initialBrandMenus || [];

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setOpenDept(null);
    setMobileOpen(false);
  }, [pathname]);

  // Small delay on close so the pointer can travel from the tab to the panel.
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenDept(null), 140);
  };
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const activeDept =
    departments.find((d) => d.slug === openDept) || departments[0] || null;

  // The dark second row always reflects a department: the one being hovered,
  // otherwise the first, so the bar is never empty.
  const barDept = activeDept;
  const barCategories = (barDept?.categories || []).slice(0, 9);

  const cartCount = mounted ? getTotalItems() : 0;
  const wishCount = mounted ? wishlistItems.length : 0;

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      {/* Utility strip */}
      <div className="hidden lg:block bg-foreground text-background/85">
        <div className="max-w-[1500px] mx-auto px-6 flex items-center justify-end gap-5 h-9 text-[11px]">
          {UTILITY_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hover:text-background transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/contact"
            className="bg-background text-foreground px-3 py-1 font-bold uppercase tracking-[0.14em] text-[10px]"
          >
            Trade Account
          </Link>
        </div>
      </div>

      {/* Main bar: logo · search · actions */}
      <div className="bg-white text-foreground border-b border-foreground/10">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 flex items-center gap-4 h-[70px]">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 -ml-2"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6" />
          </button>

          <Link href="/" className="shrink-0">
            <BrandLogo name={storeName} />
          </Link>

          <div className="hidden md:block flex-1 max-w-2xl">
            <SearchBar />
          </div>

          <div className="ml-auto flex items-center gap-4 sm:gap-6">
            <Link
              href="/track-order"
              className="hidden sm:flex flex-col items-center gap-0.5 text-[10px] font-semibold"
            >
              <Truck className="w-5 h-5" />
              Track Order
            </Link>
            <button
              type="button"
              onClick={openWishlist}
              className="relative hidden sm:flex flex-col items-center gap-0.5 text-[10px] font-semibold"
            >
              <Heart className="w-5 h-5" />
              Wish List
              {wishCount > 0 && (
                <span className="absolute -top-1 right-1 bg-foreground text-background text-[9px] rounded-full w-4 h-4 grid place-items-center">
                  {wishCount}
                </span>
              )}
            </button>
            <Link
              href={session ? "/profile" : "/login"}
              className="hidden sm:flex flex-col items-center gap-0.5 text-[10px] font-semibold"
            >
              <User className="w-5 h-5" />
              {session ? "Account" : "Log in"}
            </Link>

            <div className="flex items-stretch bg-background text-foreground">
              <button
                type="button"
                onClick={openCart}
                className="relative px-3 grid place-items-center"
                aria-label="Open basket"
              >
                <ShoppingBag className="w-5 h-5" />
                <span className="absolute top-2 right-1.5 bg-foreground text-background text-[9px] rounded-full w-4 h-4 grid place-items-center">
                  {cartCount}
                </span>
              </button>
              <Link
                href="/cart"
                className="px-4 sm:px-6 grid place-items-center bg-foreground text-background text-[11px] font-bold uppercase tracking-[0.14em]"
              >
                Checkout
              </Link>
            </div>
          </div>
        </div>

        {/* Department tabs */}
        <div className="hidden lg:block max-w-[1500px] mx-auto px-6">
          <nav className="grid grid-flow-col auto-cols-fr gap-1">
            {departments.map((dept) => {
              const open = openDept === dept.slug;
              return (
                <Link
                  key={dept.slug || dept._id}
                  href={catalogueHref({ department: dept.slug })}
                  onMouseEnter={() => {
                    cancelClose();
                    setOpenDept(dept.slug);
                  }}
                  onMouseLeave={scheduleClose}
                  className={cn(
                    "flex items-center justify-center gap-2 h-12 text-sm font-bold transition-colors",
                    open
                      ? "bg-foreground text-background"
                      : "bg-white text-foreground hover:bg-secondary",
                  )}
                >
                  {dept.name}
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Sub-category strip for the active department */}
      {barCategories.length > 0 && (
        <div
          className="hidden lg:block bg-foreground text-background"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="max-w-[1500px] mx-auto px-6 flex items-center justify-center gap-1">
            {barCategories.map((cat) => (
              <Link
                key={cat._id}
                href={catalogueHref({
                  department: barDept?.slug,
                  category: cat.slug,
                })}
                className="px-4 h-11 inline-flex items-center text-[13px] font-semibold hover:bg-background/10 transition-colors"
              >
                {cat.name}
              </Link>
            ))}
            <Link
              href="/new-arrivals"
              className="px-4 h-11 inline-flex items-center text-[13px] font-bold bg-background text-foreground ml-1"
            >
              Offers
            </Link>
          </div>
        </div>
      )}

      {/* Mega panel — filter columns, Topps-style */}
      {activeDept && openDept && (
        <div
          className="hidden lg:block bg-white border-b border-foreground/10 shadow-xl"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="max-w-[1500px] mx-auto px-6 py-8">
            <div className="grid grid-cols-12 gap-8">
              <MegaColumn
                title="Category"
                items={(activeDept.categories || []).slice(0, 9).map((c) => ({
                  label: c.name,
                  href: catalogueHref({
                    department: activeDept.slug,
                    category: c.slug,
                  }),
                }))}
              />
              <MegaColumn
                title="Type"
                items={(activeDept.categories || [])
                  .flatMap((c) =>
                    (c.children || []).map((k) => ({
                      label: k.name,
                      href: catalogueHref({
                        department: activeDept.slug,
                        category: c.slug,
                        subcategory: k.slug,
                      }),
                    })),
                  )
                  .slice(0, 9)}
              />
              <MegaColumn
                title="Size"
                items={SIZE_FACETS.map((s) => ({
                  label: s.label,
                  href: catalogueHref({
                    department: activeDept.slug,
                    size: s.value,
                  }),
                }))}
              />
              <MegaColumn
                title="Finish"
                items={FINISH_FACETS.map((f) => ({
                  label: f,
                  href: catalogueHref({
                    department: activeDept.slug,
                    finish: f.toLowerCase().replace(/\s+/g, "-"),
                  }),
                }))}
              />
              <MegaColumn
                title="Material"
                items={MATERIAL_FACETS.map((m) => ({
                  label: m,
                  href: catalogueHref({
                    department: activeDept.slug,
                    material: m.toLowerCase().replace(/\s+/g, "-"),
                  }),
                }))}
              />

              {/* Promo card */}
              <div className="col-span-2">
                <div className="relative aspect-[4/3] bg-secondary overflow-hidden">
                  {sanitizeDisplayImageUrl(activeDept.image || "") ? (
                    <Image
                      src={sanitizeDisplayImageUrl(activeDept.image || "")}
                      alt=""
                      fill
                      sizes="240px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <p className="mt-3 text-sm font-bold">{activeDept.name}</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Browse the full {activeDept.name.toLowerCase()} range from
                  every brand we stock.
                </p>
                <Link
                  href={catalogueHref({ department: activeDept.slug })}
                  className="mt-2 inline-block text-xs font-bold underline underline-offset-4"
                >
                  Shop now
                </Link>
              </div>
            </div>

            {/* Brand shortcuts */}
            {brands.length > 0 && (
              <div className="mt-8 pt-6 border-t border-foreground/10 flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-foreground/50">
                  Shop by brand
                </span>
                {brands.map((b) => (
                  <Link
                    key={b._id}
                    href={catalogueHref({
                      department: activeDept.slug,
                      brand: b.slug,
                    })}
                    className="text-[13px] font-semibold hover:underline underline-offset-4"
                  >
                    {b.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-white overflow-y-auto">
          <div className="flex items-center justify-between h-[70px] px-4 bg-white text-foreground border-b border-foreground/10">
            <BrandLogo name={storeName} />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="p-4">
            <SearchBar />
          </div>
          <nav className="pb-16">
            {departments.map((dept) => {
              const open = mobileDept === dept.slug;
              return (
                <div key={dept.slug || dept._id} className="border-b border-foreground/8">
                  <button
                    type="button"
                    onClick={() => setMobileDept(open ? null : dept.slug)}
                    className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold"
                  >
                    {dept.name}
                    <ChevronRight
                      className={cn(
                        "w-4 h-4 transition-transform",
                        open && "rotate-90",
                      )}
                    />
                  </button>
                  {open && (
                    <div className="pb-3">
                      <Link
                        href={catalogueHref({ department: dept.slug })}
                        className="block px-8 py-2.5 text-[13px] font-semibold underline underline-offset-4"
                      >
                        Shop all {dept.name}
                      </Link>
                      {(dept.categories || []).map((cat) => (
                        <Link
                          key={cat._id}
                          href={catalogueHref({
                            department: dept.slug,
                            category: cat.slug,
                          })}
                          className="block px-8 py-2.5 text-[13px]"
                        >
                          {cat.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <Link
              href="/new-arrivals"
              className="block px-5 py-4 text-sm font-bold border-b border-foreground/8"
            >
              Offers
            </Link>
            {UTILITY_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="block px-5 py-3.5 text-[13px] border-b border-foreground/8"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

function MegaColumn({
  title,
  items,
}: {
  title: string;
  items: { label: string; href: string }[];
}) {
  if (!items.length) return null;
  return (
    <div className="col-span-2">
      <h3 className="text-sm font-bold mb-3">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={`${item.label}-${item.href}`}>
            <Link
              href={item.href}
              className="text-[13px] text-foreground/75 hover:text-foreground hover:underline underline-offset-4"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

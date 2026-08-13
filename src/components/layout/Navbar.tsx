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
  Mail,
  LifeBuoy,
  X,
  Heart,
  ChevronDown,
  ChevronRight,
  BadgePercent,
  Loader2,
  Tag,
  Check,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { megaColumnsFor } from "@/lib/megaMenu";
import { storefrontBrandLabel } from "@/lib/brandDisplay";
import { ServiceStrip } from "@/components/layout/ServiceStrip";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useWishlistDrawerStore } from "@/store/useWishlistDrawerStore";
import { useTradeModeStore } from "@/store/useTradeModeStore";
import { isTradeAccount } from "@/lib/trade";
import { signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import ConfirmationModal from "@/components/common/ConfirmationModal";
import { getStoreName } from "@/app/actions/settings";
import { SearchBar } from "./SearchBar";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { subscribeCatalogChange } from "@/lib/live-sync";
import { isAccessoryCategory } from "@/lib/accessories";
import { formatDisplaySize } from "@/lib/sizeBuckets";
import { readNavCache, writeNavCache, clearNavCache } from "@/lib/navCache";
import { useSafeSession } from "@/hooks/useSafeSession";

type MenuNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  /** Legacy single association */
  subBrand?: string;
  /** All manufacturer sub-brands that sell into this category */
  subBrands?: string[];
  children?: MenuNode[];
};

type MegaTab = string | null;

type SubBrandNode = {
  name: string;
  slug: string;
};

type BrandWithMenus = {
  _id: string;
  name: string;
  /** Optional shared storefront label ("Name Show in UI"). */
  uiName?: string;
  displayName?: string;
  slug: string;
  order: number;
  image?: string;
  /** False when the brand has no storefront-priced products. */
  hasPricedProducts?: boolean;
  subBrands?: SubBrandNode[];
  menus: MenuNode[];
};

function brandLabel(brand: {
  name?: string;
  uiName?: string;
  displayName?: string;
}): string {
  // Storefront shows one name for every supplier. The real name is still on
  // the record and still drives filtering and pricing.
  return storefrontBrandLabel(
    String(brand.displayName || brand.uiName || brand.name || "").trim(),
  );
}

// const PROJECT_LINKS = [
//   { label: "Home projects", href: "/contact", note: "Private residences" },
//   { label: "Hotels & hospitality", href: "/contact", note: "Commercial suites" },
//   { label: "Restaurants & retail", href: "/contact", note: "Public interiors" },
//   { label: "Offices & workplaces", href: "/contact", note: "Corporate spaces" },
//   { label: "Start a project", href: "/custom", note: "Bespoke enquiry" },
// ];

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
  items: { label: string; href: string; note?: string }[];
  onNavigate?: () => void;
}) {
  if (!items.length) return null;
  return (
    <div className="min-w-0">
      <h4 className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground mb-3">
        {title}
      </h4>
      <ul className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
        {items.map((item, index) => (
          <li key={`${item.label}-${item.note || ""}-${item.href}-${index}`}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className="text-[12.5px] text-foreground/75 hover:text-foreground hover:underline underline-offset-4 leading-snug"
            >
              {item.label}
              {item.note ? (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground/70 no-underline">
                  {item.note}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* About mega links — About moved to footer; keep for restore.
const ABOUT_LINKS = [
  { label: "Our world", href: "/contact", note: "Brand & craft" },
  { label: "Track your order", href: "/track-order", note: "Live status" },
  { label: "Buying guides", href: "/faq", note: "Expert advice" },
  { label: "Delivery & returns", href: "/shipping-returns", note: "Orders" },
  { label: "Privacy policy", href: "/privacy", note: "Legal" },
];
*/

/** Catalogue deep-link with Department / Brand / Category filters pre-applied */
function catalogueHref(opts: {
  brand?: string | null;
  subBrand?: string | null;
  category?: string | null;
  department?: string | null;
  /** Comma-separated specs.size values */
  size?: string | null;
  colour?: string | null;
  style?: string | null;
  /** Collection / range name (specs.range). */
  range?: string | null;
}) {
  const params = new URLSearchParams();
  if (opts.department) params.set("department", opts.department);
  if (opts.brand) params.set("brand", opts.brand);
  if (opts.subBrand) params.set("subBrand", opts.subBrand);
  if (opts.category) params.set("category", opts.category);
  if (opts.size) params.set("size", opts.size);
  if (opts.colour) params.set("colour", opts.colour);
  if (opts.style) params.set("style", opts.style);
  if (opts.range) params.set("range", opts.range);
  const q = params.toString();
  return q ? `/category?${q}` : "/category";
}

function menuSubBrandSlugs(menu: {
  subBrand?: string;
  subBrands?: string[];
}): string[] {
  const fromArr = Array.isArray(menu.subBrands)
    ? menu.subBrands.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (fromArr.length) return [...new Set(fromArr)];
  const single = String(menu.subBrand || "")
    .trim()
    .toLowerCase();
  return single ? [single] : [];
}

function menuBelongsToSubBrand(
  menu: { subBrand?: string; subBrands?: string[] },
  subBrandSlug: string,
): boolean {
  const want = String(subBrandSlug || "")
    .trim()
    .toLowerCase();
  if (!want) return false;
  return menuSubBrandSlugs(menu).includes(want);
}

type DeptBrandRef = { _id: string; name: string; slug: string };

/** Brands that own a department category (from menu.brand / brandIds). */
function brandsForCategory(
  cat: { brandIds?: string[]; brand?: string },
  deptBrands: DeptBrandRef[] | undefined,
  allBrands: BrandWithMenus[],
): DeptBrandRef[] {
  const byId = new Map<string, DeptBrandRef>();
  for (const b of deptBrands || []) {
    if (b?._id && b.slug) byId.set(String(b._id), b);
  }
  for (const b of allBrands || []) {
    const id = String(b._id || "");
    if (id && b.slug && !byId.has(id)) {
      byId.set(id, { _id: id, name: b.name, slug: b.slug });
    }
  }
  const ids = (
    cat.brandIds?.length
      ? cat.brandIds
      : cat.brand
        ? [cat.brand]
        : []
  ).map(String);
  return ids.map((id) => byId.get(id)).filter(Boolean) as DeptBrandRef[];
}

function findMenusBySlug(menus: MenuNode[] | undefined, slug: string): MenuNode[] {
  const want = String(slug || "").trim().toLowerCase();
  if (!want) return [];
  const out: MenuNode[] = [];
  for (const m of menus || []) {
    if (String(m.slug || "").trim().toLowerCase() === want) out.push(m);
    if (m.children?.length) out.push(...findMenusBySlug(m.children, slug));
  }
  return out;
}

/**
 * Manufacturer sub-brands tied to categories listed in a department mega
 * (e.g. The Under Floor Heating → ProWarm / Warmup for Heating categories).
 */
function associatedSubBrandsForDeptCategories(
  cats: Array<{ slug: string; brandIds?: string[]; brand?: string; subBrands?: string[] }>,
  deptBrands: DeptBrandRef[] | undefined,
  allBrands: BrandWithMenus[],
): Array<{
  name: string;
  slug: string;
  parentBrandSlug: string;
  parentBrandName: string;
}> {
  const results: Array<{
    name: string;
    slug: string;
    parentBrandSlug: string;
    parentBrandName: string;
  }> = [];
  const seen = new Set<string>();

  for (const parent of allBrands || []) {
    if (!parent.subBrands?.length) continue;

    const associated = new Set<string>();
    for (const cat of cats) {
      const owners = brandsForCategory(cat, deptBrands, allBrands);
      const owns = owners.some(
        (b) =>
          b.slug === parent.slug || String(b._id) === String(parent._id),
      );
      if (!owns) continue;

      // Prefer associations on the brand menu tree; fall back to dept category.
      const fromMenus = findMenusBySlug(parent.menus, cat.slug);
      if (fromMenus.length) {
        for (const menu of fromMenus) {
          for (const s of menuSubBrandSlugs(menu)) associated.add(s);
        }
      } else {
        for (const s of menuSubBrandSlugs(cat)) associated.add(s);
      }
    }

    if (!associated.size) continue;

    for (const sb of parent.subBrands) {
      const slug = String(sb.slug || "").trim().toLowerCase();
      if (!slug || !associated.has(slug)) continue;
      const key = `${parent.slug}::${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        name: sb.name || slug,
      slug,
        parentBrandSlug: parent.slug,
        parentBrandName: parent.name,
      });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Map sub-brand slug/name → parent brand name for navbar "Our Brands"
 * labels like "ProWarm (By The Under Floor Heating)".
 */
function subBrandParentByKey(
  allBrands: BrandWithMenus[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const parent of allBrands || []) {
    for (const sb of parent.subBrands || []) {
      const slug = String(sb.slug || "")
        .trim()
        .toLowerCase();
      const name = String(sb.name || "")
        .trim()
        .toLowerCase();
      if (slug && !map.has(slug)) map.set(slug, parent.name);
      if (name && !map.has(name)) map.set(name, parent.name);
    }
  }
  return map;
}

function brandParentNote(
  name: string,
  slug: string,
  parentLookup: Map<string, string>,
): string | undefined {
  const parent =
    parentLookup.get(String(slug || "").trim().toLowerCase()) ||
    parentLookup.get(String(name || "").trim().toLowerCase());
  // Don't annotate a brand as its own sub-brand
  if (!parent || parent.toLowerCase() === String(name || "").toLowerCase()) {
    return undefined;
  }
  return `(By ${parent})`;
}

/** Comma-joined brand slugs for catalogue `brand=` filter (supports multi-select). */
function brandFilterParam(brands: DeptBrandRef[]): string | null {
  const slugs = brands.map((b) => b.slug).filter(Boolean);
  return slugs.length ? slugs.join(",") : null;
}

type DeptCategoryRef = {
  slug: string;
  brandIds?: string[];
  brand?: string;
  subBrands?: string[];
  subBrand?: string;
};

/**
 * Category slugs listed in a department mega that are owned by `brandSlug`
 * (e.g. Tiles → Spectra → Floor and Wall, Gloss, …).
 */
function deptCategorySlugsForBrand(
  cats: DeptCategoryRef[],
  brandSlug: string,
  deptBrands: DeptBrandRef[] | undefined,
  allBrands: BrandWithMenus[],
): string[] {
  const want = String(brandSlug || "")
    .trim()
    .toLowerCase();
  if (!want) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const cat of cats) {
    const slug = String(cat.slug || "").trim();
    if (!slug || seen.has(slug)) continue;
    const owns = brandsForCategory(cat, deptBrands, allBrands).some(
      (b) => String(b.slug || "").toLowerCase() === want,
    );
    if (!owns) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/**
 * Category slugs in a department mega tied to a manufacturer sub-brand
 * (parent brand + sub-brand association on that category / brand menu).
 */
function deptCategorySlugsForSubBrand(
  cats: DeptCategoryRef[],
  parentBrandSlug: string,
  subBrandSlug: string,
  deptBrands: DeptBrandRef[] | undefined,
  allBrands: BrandWithMenus[],
): string[] {
  const parentWant = String(parentBrandSlug || "")
    .trim()
    .toLowerCase();
  const subWant = String(subBrandSlug || "")
    .trim()
    .toLowerCase();
  if (!parentWant || !subWant) return [];

  const parent = (allBrands || []).find(
    (b) => String(b.slug || "").toLowerCase() === parentWant,
  );
  const out: string[] = [];
  const seen = new Set<string>();

  for (const cat of cats) {
    const slug = String(cat.slug || "").trim();
    if (!slug || seen.has(slug)) continue;

    const owns = brandsForCategory(cat, deptBrands, allBrands).some(
      (b) => String(b.slug || "").toLowerCase() === parentWant,
    );
    if (!owns) continue;

    const fromMenus = findMenusBySlug(parent?.menus, slug);
    let linked = false;
    if (fromMenus.length) {
      linked = fromMenus.some((m) => menuSubBrandSlugs(m).includes(subWant));
    } else {
      linked = menuSubBrandSlugs(cat).includes(subWant);
    }
    if (!linked) continue;

    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/**
 * Category mega links with brand filter applied.
 * Shared slugs (e.g. Pitched Roof Windows on FAKRO + Sterlingbuild) stay one
 * row and pre-select every owning brand: `brand=fakro,sterlingbuild`.
 */
function categoryFacetItems(
  cats: Array<{
    _id: string;
    name: string;
    slug: string;
    brandIds?: string[];
    brand?: string;
  }>,
  deptSlug: string,
  deptBrands: DeptBrandRef[] | undefined,
  allBrands: BrandWithMenus[],
  limit = 14,
): { label: string; href: string }[] {
  const items: { label: string; href: string }[] = [];
  for (const c of cats) {
    const brands = brandsForCategory(c, deptBrands, allBrands);
    items.push({
      label: c.name,
      href: catalogueHref({
        department: deptSlug,
        category: c.slug,
        brand: brandFilterParam(brands),
      }),
    });
    if (items.length >= limit) break;
  }
  return items.slice(0, limit);
}

type DepartmentNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  /** Brands that own categories in this department (for "Our Brands"). */
  brands?: Array<{ _id: string; name: string; slug: string }>;
  brandIds?: string[];
  /** Available Small/Medium/Large/XL buckets from real product sizes. */
  sizeBuckets?: Array<{
    key: string;
    label: string;
    example: string;
    sizes: string[];
    count: number;
  }>;
  /** Distinct product colours for this department (navbar Colors column). */
  colors?: Array<{
    value: string;
    label: string;
    count: number;
    /** Brands that stock this colour — auto-applied on click. */
    brandSlugs?: string[];
  }>;
  /** Distinct product styles / finishes (navbar Style column). */
  styles?: Array<{
    value: string;
    label: string;
    count: number;
    /** Brands that stock this style — auto-applied on click. */
    brandSlugs?: string[];
  }>;
  categories?: Array<{
    _id: string;
    name: string;
    slug: string;
    image?: string;
    brand?: string;
    brandIds?: string[];
    /** Manufacturer sub-brand slugs associated with this category */
    subBrand?: string;
    subBrands?: string[];
    isAccessory?: boolean;
    /** Brand ids with priced products in this accessory range. */
    pricedBrandIds?: string[];
    children?: MenuNode[];
  }>;
};

function dedupeDepartments(list: DepartmentNode[] | undefined | null): DepartmentNode[] {
  const seen = new Set<string>();
  const out: DepartmentNode[] = [];
  for (const dept of list || []) {
    const key = String(dept.slug || dept._id || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(dept);
  }
  return out;
}

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
  const { data: session, status } = useSafeSession();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [storeName, setStoreName] = useState(
    initialStoreName || "Linx Square",
  );

  // Soft-nav to contact/login/about remounts <Navbar /> without RSC props.
  // Seed from session cache so department/brand mega-menus don't flash empty.
  const cachedNav =
    !initialBrandMenus?.length || !initialDepartments?.length
      ? readNavCache()
      : null;
  const [brandMenus, setBrandMenus] = useState<BrandWithMenus[]>(
    initialBrandMenus?.length
      ? initialBrandMenus
      : ((cachedNav?.brands as BrandWithMenus[]) || []),
  );
  const [departmentTrees, setDepartmentTrees] = useState<DepartmentNode[]>(
    initialDepartments?.length
      ? dedupeDepartments(initialDepartments)
      : dedupeDepartments(
          (cachedNav?.departments as DepartmentNode[]) || [],
        ),
  );
  const [selectedDepartmentSlug, setSelectedDepartmentSlug] = useState<
    string | null
  >(
    initialDepartments?.[0]?.slug ||
      (cachedNav?.departments?.[0] as DepartmentNode | undefined)?.slug ||
      null,
  );
  // Brands panel mirrors Departments: names on the left, that brand's
  // categories on the right.
  const [selectedBrandSlug, setSelectedBrandSlug] = useState<string | null>(
    initialBrandMenus?.[0]?.slug ||
      (cachedNav?.brands?.[0] as BrandWithMenus | undefined)?.slug ||
      null,
  );
  const [selectedSubBrandSlug, setSelectedSubBrandSlug] = useState<
    string | null
  >(null);
  const [menusLoading, setMenusLoading] = useState(
    !(
      initialBrandMenus?.length ||
      (cachedNav?.brands as BrandWithMenus[] | undefined)?.length
    ),
  );
  const [activeTab, setActiveTab] = useState<MegaTab>(null);
  /** Which department's categories are expanded in the mobile drawer. */
  const [mobileDept, setMobileDept] = useState<string | null>(null);
  const [activeProductFamily, setActiveProductFamily] = useState<string | null>(
    null,
  );
  const [mobileSection, setMobileSection] = useState<MegaTab>(null);
  const brandMenusRef = useRef(brandMenus);
  brandMenusRef.current = brandMenus;
  const pathname = usePathname();
  const router = useRouter();
  const isTradeMode = useTradeModeStore((s) => s.isTradeMode);
  const toggleTradeMode = useTradeModeStore((s) => s.toggle);
  const isRealTradeAccount = isTradeAccount(session?.user);

  const brandMenusContentKey = (brands: BrandWithMenus[] | undefined) =>
    JSON.stringify(
      (brands || []).map((b) => ({
        id: b._id,
        image: b.image,
        subBrands: (b.subBrands || []).map((s) => s.slug),
        menus: (b.menus || []).map((m) => [
          m._id,
          m.name,
          m.image,
          m.subBrand || "",
          ...(m.subBrands || []),
        ]),
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
    writeNavCache({ brands: initialBrandMenus });
    // Do not prefetch every category's products here — one server action each.
    // Products mega loads on demand when the tab / category is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content-keyed
  }, [initialBrandMenus]);

  useEffect(() => {
    if (!initialDepartments?.length) return;
    const next = dedupeDepartments(initialDepartments);
    setDepartmentTrees(next);
    setSelectedDepartmentSlug((prev) => prev || next[0]?.slug || null);
    writeNavCache({ departments: next });
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
    const cached = readNavCache();
    const hasCachedBrands = Boolean(cached?.brands?.length);
    const hasCachedDepartments = Boolean(cached?.departments?.length);

    const refreshBrands = async (opts?: { silent?: boolean }) => {
      try {
        if (!opts?.silent && !brandMenusRef.current.length) {
          setMenusLoading(true);
        }

        const { getBrandMenuTrees } = await import("@/app/actions/admin");
        const result = await getBrandMenuTrees();
        if (cancelled) return;

        const next =
          result.success && result.brands?.length ? result.brands : [];
        setBrandMenus(next);
        if (next.length) writeNavCache({ brands: next });
      } catch {
        if (cancelled) return;
        if (!brandMenusRef.current.length) setBrandMenus([]);
      } finally {
        if (!cancelled) setMenusLoading(false);
      }
    };

    // Prefer RSC props, then session cache; only show loading + fetch when empty.
    if (!hasInitial && !hasCachedBrands) {
      refreshBrands();
    } else if (!hasInitial && hasCachedBrands) {
      // Background refresh without clearing the visible mega-menu.
      refreshBrands({ silent: true });
    }

    const refreshDepartments = async () => {
      try {
        const { getDepartmentTrees } = await import(
          "@/app/actions/departments"
        );
        const result = await getDepartmentTrees();
        if (cancelled) return;
        if (result.success) {
          const next = dedupeDepartments(result.departments || []);
          setDepartmentTrees(next);
          if (next.length) writeNavCache({ departments: next });
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
    if (!hasInitialDepartments && !hasCachedDepartments) {
      refreshDepartments();
    } else if (!hasInitialDepartments && hasCachedDepartments) {
      refreshDepartments();
    }

    let catalogDebounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeCatalogChange(() => {
      // Coalesce admin sync storms into one refresh
      if (catalogDebounce) clearTimeout(catalogDebounce);
      catalogDebounce = setTimeout(() => {
        if (cancelled) return;
        clearNavCache();
        refreshBrands({ silent: true });
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
          brandName: brandLabel(brand),
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
          // Stays visible while scrolling — showroom, phone and email are the
          // main contact routes, so collapsing them hid the details customers
          // look for once they are deep in the catalogue.
          "hidden lg:block bg-white border-b border-foreground/8 text-[10px] uppercase tracking-[0.22em] font-bold h-10 opacity-100",
        )}
      >
        <div className="site-container h-full flex items-center justify-between">
        <div className="flex items-center gap-6 text-foreground/70">
          {isRealTradeAccount ? (
            // Approved trade accounts always have the discount — no toggle to
            // avoid them ever seeing full price while still being charged less.
            <span className="flex items-center gap-2 text-primary">
              <Check className="w-3.5 h-3.5" />
              Trade account · Active
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                const turningOn = !isTradeMode;
                toggleTradeMode();
                toast[turningOn ? "success" : "info"](
                  turningOn
                    ? "Trade pricing activated — 5% off every product"
                    : "Trade pricing switched off",
                );
                router.push("/");
              }}
              className={cn(
                "flex items-center gap-2 transition-colors",
                mounted && isTradeMode
                  ? "text-primary font-bold"
                  : "hover:text-foreground",
              )}
            >
              {mounted && isTradeMode ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <BadgePercent className="w-3.5 h-3.5 opacity-70" />
              )}
              {mounted && isTradeMode
                ? "Trade pricing on · Exit"
                : "Trade account"}
            </button>
          )}
          <Link
            href="tel:02046342203"
            className="flex items-center gap-2 hover:text-foreground transition-colors"
          >
            <Phone className="w-3.5 h-3.5 opacity-70" />
            <span className="opacity-70">Need help? Speak to our team</span>
            <span className="text-foreground">020 4634 2203</span>
          </Link>
          <a
            href="mailto:info@linxsquare.co.uk"
            className="flex items-center gap-2 hover:text-foreground transition-colors"
          >
            <Mail className="w-3.5 h-3.5 opacity-70" />
            info@linxsquare.co.uk
          </a>
        </div>
        <div className="flex items-center gap-6 text-foreground/70">
          <Link
            href="/linx-distribution"
            className="hover:text-foreground transition-colors"
          >
            LINX Square Distribution
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
          {/* Contact us — moved to footer
          <Link href="/contact" className="hover:text-foreground transition-colors">
            Contact us
          </Link>
          */}
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

            {/* One tap to call on mobile — the desktop bar above carries the
                number, but it is hidden below lg. */}
            <a
              href="tel:02046342203"
              className="lg:hidden p-1.5 sm:p-2 hover:opacity-70 transition-opacity"
              aria-label="Call our sales and technical support team on 020 4634 2203"
            >
              <Phone className="w-5 h-5 stroke-[1.5]" />
            </a>

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
            className="flex items-center justify-center gap-2 xl:gap-4 min-h-11.5"
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
              /* A link, not a button: hovering still opens the mega panel,
                 but clicking goes straight to that department's catalogue so
                 the tab itself is a way to browse the whole range. */
              <Link
                  key={dept.slug || dept._id}
                  href={catalogueHref({ department: dept.slug })}
                  onMouseEnter={() => openTab(tab)}
                  onFocus={() => openTab(tab)}
                  onClick={closeMega}
                className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors whitespace-nowrap",
                    isOpen
                    ? "text-foreground border-foreground"
                    : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
                )}
                  aria-expanded={isOpen}
                >
                  {dept.name}
                </Link>
              );
            })}
            <Link
              href="/category?onSale=1"
              onMouseEnter={closeMega}
              className="inline-flex items-center gap-1.5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold text-[#D3102F] border-b-2 border-transparent hover:border-[#D3102F] transition-colors whitespace-nowrap"
            >
              <Tag className="w-3 h-3 stroke-2" />
              Sale
            </Link>
            {/* Brands dropdown — temporarily hidden
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
            */}
            {/* About — moved to footer
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
            */}
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
            {/* Contact Us — moved to footer
            <Link
              href="/contact"
              onMouseEnter={closeMega}
              className={cn(
                "inline-flex items-center px-3 py-3 text-[10px] uppercase tracking-[0.16em] font-bold border-b-2 transition-colors whitespace-nowrap",
                pathname === "/contact" && !activeTab
                  ? "text-foreground border-foreground"
                  : "text-foreground/65 border-transparent hover:text-foreground hover:border-foreground/25",
              )}
            >
              Contact Us
            </Link>
            */}
          </nav>
        </div>

        {/* Mega panel */}
        <div
          className={cn(
            "absolute left-0 right-0 top-full z-20 bg-white border-b border-foreground/10 shadow-[0_28px_70px_rgba(0,0,0,0.1)] transition-all duration-300",
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

              // Merchandised columns take precedence for every department that
              // has them, Accessories included. Checked before the by-brand
              // fallback below, which would otherwise return first.
              const curatedEarly = megaColumnsFor(dept.slug);
              if (curatedEarly) {
                return (
                  <div className="site-container py-8">
                    <div className="flex items-end justify-between gap-4 mb-6">
                      <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
                        Shop {dept.name}
                      </p>
                      <Link
                        href={catalogueHref({ department: dept.slug })}
                        onClick={closeMega}
                        className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                      >
                        View all {dept.name}
                      </Link>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-7 md:grid-cols-3 lg:grid-cols-5">
                      {curatedEarly.map((col) => (
                        <MegaFacetColumn
                          key={col.title}
                          title={col.title}
                          items={col.links.map((l) => ({
                            label: l.label,
                            href: `${catalogueHref({
                              department: dept.slug,
                              category: l.category || null,
                              brand: l.brand || null,
                            })}${
                              l.subcategory
                                ? `&subcategory=${encodeURIComponent(l.subcategory)}`
                                : ""
                            }`,
                          }))}
                          onNavigate={closeMega}
                        />
                      ))}
                    </div>
                  </div>
                );
              }

              // Accessories keeps the previous by-brand grid (not Category/Type/Size).
              if (dept.slug === "accessories") {
                type AccItem = { _id: string; name: string; slug: string };
                const byBrand = new Map<
                  string,
                  {
                    brand: { _id: string; name: string; slug: string };
                    menus: AccItem[];
                  }
                >();

                const addAcc = (
                  brand: { _id: string; name: string; slug: string },
                  menu: AccItem,
                ) => {
                  const key = String(brand.slug || brand._id);
                  if (!key || !menu?.slug) return;
                  let group = byBrand.get(key);
                  if (!group) {
                    group = {
                      brand: {
                        _id: String(brand._id),
                        name: brandLabel(brand),
                        slug: brand.slug,
                      },
                      menus: [],
                    };
                    byBrand.set(key, group);
                  }
                  if (!group.menus.some((m) => m.slug === menu.slug)) {
                    group.menus.push({
                      _id: String(menu._id),
                      name: menu.name,
                      slug: menu.slug,
                    });
                  }
                };

                for (const brand of brandMenus) {
                  if (brand.hasPricedProducts === false) continue;
                  for (const m of brand.menus || []) {
                    if (isAccessoryCategory(m.name, m.slug)) {
                      addAcc(brand, m);
                    }
                    for (const child of m.children || []) {
                      if (isAccessoryCategory(child.name, child.slug)) {
                        addAcc(brand, child);
                      }
                    }
                  }
                }

                for (const c of dept.categories || []) {
                  if (!c.isAccessory && !isAccessoryCategory(c.name, c.slug)) {
                    continue;
                  }
                  if (!Array.isArray(c.pricedBrandIds)) continue;
                  if (c.pricedBrandIds.length === 0) continue;
                  const pricedIds = new Set(c.pricedBrandIds.map(String));
                  const owners = brandsForCategory(
                    c,
                    dept.brands,
                    brandMenus,
                  ).filter((b) => pricedIds.has(String(b._id)));
                  for (const b of owners) {
                    if (
                      brandMenus.some(
                        (bm) =>
                          String(bm._id) === String(b._id) &&
                          bm.hasPricedProducts === false,
                      )
                    ) {
                      continue;
                    }
                    addAcc(b, c);
                  }
                }

                const groups = [...byBrand.values()]
                  .map((g) => ({
                    ...g,
                    menus: g.menus.sort((a, b) =>
                      a.name.localeCompare(b.name),
                    ),
                  }))
                  .sort((a, b) =>
                    brandLabel(a.brand).localeCompare(brandLabel(b.brand)),
                  );

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
                        href={catalogueHref({ department: "accessories" })}
                        onClick={closeMega}
                        className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                      >
                        View all accessories
                      </Link>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-6">
                      {groups.map(({ brand, menus }) => (
                        <div key={brand._id}>
                          <Link
                            /* No department here: "accessories" is a virtual
                               grouping built from accessory categories across
                               brands, not a department products carry. Adding
                               it filtered every result out. */
                            href={catalogueHref({ brand: brand.slug })}
                            onClick={closeMega}
                            className="block text-[10.5px] uppercase tracking-[0.16em] font-bold mb-2 hover:text-primary transition-colors"
                          >
                            {brandLabel(brand)}
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
              }

              // Other departments: Category / Type / Size / Brands layout.
              const cats = (dept.categories || []).filter(
                (c) =>
                  !c.isAccessory && !isAccessoryCategory(c.name, c.slug),
              );
              // Dedupe by category+subcategory slug — Britmet (and similar)
              // can carry duplicate Menu children with the same slug, which
              // React would otherwise warn on as duplicate list keys.
              const types = (() => {
                const seen = new Set<string>();
                const out: Array<{
                  cat: (typeof cats)[number];
                  child: MenuNode;
                }> = [];
                for (const c of cats) {
                  for (const child of c.children || []) {
                    const key = `${c.slug}::${child.slug}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    out.push({ cat: c, child });
                    if (out.length >= 9) return out;
                  }
                }
                return out;
              })();
              // Our Brands = brands that own these (non-accessory) categories,
              // plus manufacturer sub-brands tied to those listed categories
              // (e.g. The Under Floor Heating → ProWarm / Warmup).
              const seenBrand = new Set<string>();
              const brandsToShow: Array<{ name: string; slug: string }> = [];
              const pushBrand = (b?: { name?: string; slug?: string } | null) => {
                const key = String(b?.slug || "").toLowerCase();
                if (!key || !b?.name || seenBrand.has(key)) return;
                seenBrand.add(key);
                brandsToShow.push({ name: b.name, slug: b.slug! });
              };
              for (const c of cats) {
                for (const b of brandsForCategory(c, dept.brands, brandMenus)) {
                  pushBrand(b);
                  if (brandsToShow.length >= 12) break;
                }
                if (brandsToShow.length >= 12) break;
              }
              // Fallback if brandIds missing on older cached trees
              if (!brandsToShow.length) {
                const catSlugs = new Set(cats.map((c) => c.slug));
                for (const b of brandMenus) {
                  if ((b.menus || []).some((m) => catSlugs.has(m.slug))) {
                    pushBrand(b);
                  }
                }
              }
              const subBrandsToShow = associatedSubBrandsForDeptCategories(
                cats,
                dept.brands,
                brandMenus,
              );
              const cover =
                sanitizeDisplayImageUrl(dept.image || "") ||
                firstImageFrom(cats);

              const brandForCat = (cat: {
                brandIds?: string[];
                brand?: string;
              }) =>
                brandFilterParam(
                  brandsForCategory(cat, dept.brands, brandMenus),
                );

              // Only real product sizes / colors / styles for this department.
              const sizeBuckets = dept.sizeBuckets || [];
              const colorFacets = dept.colors || [];
              const styleFacets = dept.styles || [];
              // Collection / range — the grouping flooring brands carry where
              // they have no colour or finish attributes.
              const rangeFacets = (dept as any).ranges || [];
              const categoryItems = categoryFacetItems(
                cats,
                dept.slug,
                dept.brands,
                brandMenus,
              );
              const typeItems = types.map(({ cat, child }) => ({
                label: child.name,
                href: `${catalogueHref({
                  department: dept.slug,
                  category: cat.slug,
                  brand: brandForCat(cat),
                })}&subcategory=${encodeURIComponent(child.slug)}`,
              }));
              const sizeItems = sizeBuckets.map((z) => {
                const sizes = z.sizes || [];
                const exampleRaw = z.example
                  ? String(z.example)
                  : sizes[0] || "";
                const example = exampleRaw
                  ? formatDisplaySize(exampleRaw) || exampleRaw
                  : "";
                return {
                  label: example
                    ? `${z.label} (e.g. ${example})`
                    : z.label,
                  href: catalogueHref({
                    department: dept.slug,
                    size: sizes.length ? sizes.join(",") : null,
                  }),
                };
              });
              const colorItems = colorFacets.map((c) => ({
                label: c.label,
                href: catalogueHref({
                  department: dept.slug,
                  colour: c.value,
                  brand: c.brandSlugs?.length
                    ? c.brandSlugs.join(",")
                    : null,
                }),
              }));
              const styleItems = styleFacets.map((s) => ({
                label: s.label,
                href: catalogueHref({
                  department: dept.slug,
                  style: s.value,
                  brand: s.brandSlugs?.length
                    ? s.brandSlugs.join(",")
                    : null,
                }),
              }));
              const rangeItems = rangeFacets.map((r: any) => ({
                label: r.label,
                href: catalogueHref({
                  department: dept.slug,
                  range: r.value,
                  brand: r.brandSlugs?.length ? r.brandSlugs.join(",") : null,
                }),
              }));
              const subBrandParents = subBrandParentByKey(brandMenus);
              // Brand / sub-brand clicks pre-select every Category column
              // entry owned by that brand (or sub-brand) in this department.
              const brandItems = [
                ...brandsToShow.map((b) => {
                  const brandCats = deptCategorySlugsForBrand(
                    cats,
                    b.slug,
                    dept.brands,
                    brandMenus,
                  );
                  return {
                    label: b.name,
                    note: brandParentNote(b.name, b.slug, subBrandParents),
                    href: catalogueHref({
                      department: dept.slug,
                      brand: b.slug,
                      category: brandCats.length
                        ? brandCats.join(",")
                        : null,
                    }),
                  };
                }),
                ...subBrandsToShow.map((sb) => {
                  const subCats = deptCategorySlugsForSubBrand(
                    cats,
                    sb.parentBrandSlug,
                    sb.slug,
                    dept.brands,
                    brandMenus,
                  );
                  return {
                    label: sb.name,
                    note: `(By ${sb.parentBrandName})`,
                    href: catalogueHref({
                      department: dept.slug,
                      brand: sb.parentBrandSlug,
                      subBrand: sb.slug,
                      category: subCats.length ? subCats.join(",") : null,
                    }),
                  };
                }),
              ];

              // Merchandised columns when the department has them; otherwise
              // fall back to the facet-derived Category/Type/Size/... layout.
              const curated = megaColumnsFor(dept.slug);
              if (curated) {
                return (
                  <div className="site-container py-8">
                    <div className="flex flex-wrap items-start gap-x-10 gap-y-8 lg:flex-nowrap">
                      <div className="grid flex-1 grid-cols-2 gap-x-8 gap-y-7 md:grid-cols-3 lg:grid-cols-5">
                        {curated.map((col) => (
                          <MegaFacetColumn
                            key={col.title}
                            title={col.title}
                            items={col.links.map((l) => ({
                              label: l.label,
                              href: `${catalogueHref({
                                department: dept.slug,
                                category: l.category || null,
                                brand: l.brand || null,
                              })}${
                                l.subcategory
                                  ? `&subcategory=${encodeURIComponent(l.subcategory)}`
                                  : ""
                              }`,
                            }))}
                            onNavigate={closeMega}
                          />
                        ))}
                      </div>

                      {cover ? (
                        <Link
                          href={catalogueHref({ department: dept.slug })}
                          onClick={closeMega}
                          className="hidden w-[16rem] shrink-0 xl:block"
                        >
                          <div className="relative aspect-4/3 overflow-hidden bg-secondary">
                            <Image
                              src={cover}
                              alt={dept.name}
                              fill
                              sizes="256px"
                              className="object-cover transition-transform duration-500 hover:scale-105"
                            />
                          </div>
                          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.2em]">
                            Shop all {dept.name}
                          </p>
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              }

              return (
                <div className="site-container py-8">
                  {/* Flex (not fixed 12-col) so missing Type/Size/etc. don't
                      leave a blank reserved column between Category and Size. */}
                  <div className="flex flex-wrap lg:flex-nowrap gap-x-8 gap-y-8 items-start">
                    <div className="flex flex-wrap gap-x-8 gap-y-6 flex-1 min-w-0">
                      {categoryItems.length > 0 ? (
                        <div className="w-38 shrink-0">
                          <MegaFacetColumn
                            title="Category"
                            items={categoryItems}
                            onNavigate={closeMega}
                          />
                        </div>
                      ) : null}
                      {typeItems.length > 0 ? (
                        <div className="w-38 shrink-0">
                          <MegaFacetColumn
                            title="Type"
                            items={typeItems}
                            onNavigate={closeMega}
                          />
                        </div>
                      ) : null}
                      {sizeItems.length > 0 ? (
                        <div className="w-44 shrink-0">
                          <MegaFacetColumn
                            title="Size"
                            items={sizeItems}
                            onNavigate={closeMega}
                          />
                        </div>
                      ) : null}
                      {colorItems.length > 0 ? (
                        <div className="w-38 shrink-0">
                          <MegaFacetColumn
                            title="Colors"
                            items={colorItems}
                            onNavigate={closeMega}
                          />
                        </div>
                      ) : null}
                      {styleItems.length > 0 ? (
                        <div className="w-38 shrink-0">
                          <MegaFacetColumn
                            title="Style"
                            items={styleItems}
                            onNavigate={closeMega}
                          />
                        </div>
                      ) : null}
                      {rangeItems.length > 0 ? (
                        <div className="w-44 shrink-0">
                          <MegaFacetColumn
                            title="Range"
                            items={rangeItems}
                            onNavigate={closeMega}
                          />
                        </div>
                      ) : null}
                      {brandItems.length > 0 ? (
                        <div className="w-52 shrink-0">
                          <MegaFacetColumn
                            title="Our Brands"
                            items={brandItems}
                            onNavigate={closeMega}
                          />
                        </div>
                      ) : null}
                    </div>

                    {/* Promo card */}
                    <div className="w-full lg:w-56 xl:w-[16rem] shrink-0">
                      <div className="bg-secondary/40 p-4">
                        <div className="relative aspect-4/3 bg-secondary overflow-hidden mb-3">
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
                            brand: brandForCat(c),
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

          {/* BRANDS — brand names on the left; when a brand has sub-brands,
              middle column lists them and the right shows that sub-brand's
              categories. Otherwise categories fill the right pane.
              Temporarily hidden with the Brands nav tab. */}
          {false && activeTab === "brands" && (
            <div className="site-container py-5 grid grid-cols-12 gap-0 h-95">
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
                (() => {
                  const selected =
                    brandMenus.find((b) => b.slug === selectedBrandSlug) ||
                    brandMenus[0];
                  const subBrands = selected?.subBrands || [];
                  const hasSubBrands = subBrands.length > 0;
                  const menusForBrand = selected?.menus || [];
                  const menusBySub = new Map<string, MenuNode[]>();
                  const unassignedMenus: MenuNode[] = [];
                  for (const menu of menusForBrand) {
                    const keys = menuSubBrandSlugs(menu);
                    if (!keys.length) {
                      unassignedMenus.push(menu);
                      continue;
                    }
                    for (const key of keys) {
                      if (!menusBySub.has(key)) menusBySub.set(key, []);
                      menusBySub.get(key)!.push(menu);
                    }
                  }
                  const activeSubSlug =
                    selectedSubBrandSlug === "__other__"
                      ? "__other__"
                      : selectedSubBrandSlug &&
                          subBrands.some((s) => s.slug === selectedSubBrandSlug)
                        ? selectedSubBrandSlug
                        : subBrands[0]?.slug || null;
                  const activeSub =
                    activeSubSlug && activeSubSlug !== "__other__"
                      ? subBrands.find((s) => s.slug === activeSubSlug) || null
                      : null;
                  const resolvedSubSlug =
                    typeof activeSubSlug === "string" &&
                    activeSubSlug !== "__other__"
                      ? String(activeSubSlug)
                      : "";
                  const subCats = resolvedSubSlug
                    ? menusBySub.get(resolvedSubSlug) || []
                    : [];

                  const selectBrand = (slug: string) => {
                    setSelectedBrandSlug(slug);
                    setSelectedSubBrandSlug(null);
                  };

                  return (
                    <>
                      <aside
                        className={cn(
                          "border-r border-foreground/8 pr-4 flex flex-col min-h-0 h-full",
                          hasSubBrands ? "col-span-3" : "col-span-4",
                        )}
                      >
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
                                  onMouseEnter={() => selectBrand(brand.slug)}
                                  onFocus={() => selectBrand(brand.slug)}
                                  onClick={() => selectBrand(brand.slug)}
                          className={cn(
                                    "w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-[12px] tracking-wide transition-colors",
                            isActive
                              ? "bg-secondary text-foreground font-semibold"
                              : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
                          )}
                        >
                                  <span className="truncate uppercase tracking-[0.08em]">
                                    {brandLabel(brand)}
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

                      {hasSubBrands && selected ? (
                        <>
                          <aside className="col-span-3 border-r border-foreground/8 px-4 flex flex-col min-h-0 h-full">
                            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
                              <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
                                Sub-brands
                              </p>
                <Link
                                href={catalogueHref({ brand: selected.slug })}
                                onClick={closeMega}
                                className="text-[9px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-primary"
                >
                                All
                </Link>
                            </div>
                            <ul className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-0.5 pr-1">
                              {subBrands.map((sb) => {
                                const isActive = activeSubSlug === sb.slug;
                                const count = (menusBySub.get(sb.slug) || [])
                                  .length;
                                return (
                                  <li key={sb.slug}>
                                    <button
                                      type="button"
                                      onMouseEnter={() =>
                                        setSelectedSubBrandSlug(sb.slug)
                                      }
                                      onFocus={() =>
                                        setSelectedSubBrandSlug(sb.slug)
                                      }
                                      onClick={() =>
                                        setSelectedSubBrandSlug(sb.slug)
                                      }
                                      className={cn(
                                        "w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12px] tracking-wide transition-colors",
                                        isActive
                                          ? "bg-secondary text-foreground font-semibold"
                                          : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
                                      )}
                                    >
                                      <span className="truncate">{sb.name}</span>
                                      {count > 0 ? (
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                          {count}
                                        </span>
                                      ) : null}
                                    </button>
                                  </li>
                                );
                              })}
                              {unassignedMenus.length > 0 ? (
                                <li>
                                  <button
                                    type="button"
                                    onMouseEnter={() =>
                                      setSelectedSubBrandSlug("__other__")
                                    }
                                    onFocus={() =>
                                      setSelectedSubBrandSlug("__other__")
                                    }
                                    onClick={() =>
                                      setSelectedSubBrandSlug("__other__")
                                    }
                                    className={cn(
                                      "w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12px] tracking-wide transition-colors",
                                      activeSubSlug === "__other__"
                                        ? "bg-secondary text-foreground font-semibold"
                                        : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
                                    )}
                                  >
                                    <span className="truncate">Other ranges</span>
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      {unassignedMenus.length}
                                    </span>
                                  </button>
                                </li>
                              ) : null}
                            </ul>
              </aside>

                          <div className="col-span-6 pl-6 xl:pl-8 py-1 h-full overflow-hidden">
                            {(() => {
                              const showOther = activeSubSlug === "__other__";
                              const cats = showOther
                                ? unassignedMenus
                                : subCats;
                              const heading = showOther
                                ? "Other ranges"
                                : activeSub?.name || selected.name;
                              const viewHref = showOther
                                ? catalogueHref({ brand: selected.slug })
                                : catalogueHref({
                                    brand: selected.slug,
                                    subBrand: activeSub?.slug,
                                  });

                              return (
                                <div className="h-full flex flex-col animate-in fade-in duration-300">
                                  <div className="flex items-end justify-between gap-4 shrink-0 mb-4">
                      <div>
                                      <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-bold mb-1">
                                        Categories
                        </p>
                                      <h3 className="font-serif text-xl tracking-[0.06em] uppercase">
                                        {heading}
                        </h3>
                      </div>
                      <Link
                                      href={viewHref}
                                      onClick={closeMega}
                        className="text-[10px] uppercase tracking-[0.25em] font-bold hover:text-primary transition-colors"
                      >
                                      View all
                      </Link>
                    </div>

                                  {cats.length > 0 ? (
                                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                                      <div className="grid grid-cols-2 gap-2 content-start">
                                        {cats.map((cat) => (
                          <Link
                                            key={cat._id}
                                            href={catalogueHref({
                                              brand: selected.slug,
                                              subBrand: showOther
                                                ? null
                                                : activeSub?.slug,
                                              category: cat.slug,
                                            })}
                                            onClick={closeMega}
                                            className="px-3 py-3 border border-foreground/8 hover:border-foreground/20 text-[12px] tracking-wide transition-colors"
                                          >
                                            {cat.name}
                                            {(cat.children || []).length >
                                            0 ? (
                                              <span className="block text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
                                                {(cat.children || []).length}{" "}
                                                types
                            </span>
                                            ) : null}
                          </Link>
                        ))}
                                      </div>
                      </div>
                    ) : (
                                    <div className="flex-1 flex items-start">
                        <Link
                                        href={viewHref}
                                        onClick={closeMega}
                                        className="inline-flex text-[12px] uppercase tracking-[0.16em] font-bold border-b border-foreground/30 pb-1 hover:border-foreground"
                        >
                                        Shop {heading}
                                      </Link>
                      </div>
                    )}
                  </div>
                              );
                            })()}
              </div>
                        </>
                      ) : (
                        <div className="col-span-8 pl-6 xl:pl-10 py-1 h-full overflow-hidden">
                          {selected ? (
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

                              {menusForBrand.length > 0 ? (
                                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                                  <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 content-start">
                                    {menusForBrand.map((cat) => (
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
                                    href={catalogueHref({
                                      brand: selected.slug,
                                    })}
                                    onClick={closeMega}
                                    className="inline-flex text-[12px] uppercase tracking-[0.16em] font-bold border-b border-foreground/30 pb-1 hover:border-foreground"
                                  >
                                    Shop {selected.name}
                                  </Link>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </>
                  );
                })()
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
                          {brandLabel(brand)}
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

          {/* ABOUT — moved to footer
          {activeTab === "about" && (
            <div className="site-container py-10 grid grid-cols-12 gap-10 min-h-[280px]">
              ...
            </div>
          )}
          */}
        </div>
      </div>

      {/* Below the menu row. The mega panel is stacked above it (z-20) so a
          hovered panel covers the strip rather than it bleeding through. */}
      <ServiceStrip />
      </div>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-100 lg:hidden transition-all duration-500",
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

            <div className="px-6 py-4 border-b border-foreground/8">
              <Link
                href="/category?onSale=1"
                onClick={() => setIsMenuOpen(false)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-[#D3102F] text-white text-[11px] uppercase tracking-[0.2em] font-bold"
              >
                <Tag className="w-4 h-4" />
                Sale
              </Link>
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
                <div>
                  {departmentTrees.length === 0 ? (
                    <p className="px-6 py-2 text-sm text-muted-foreground">
                      No departments yet.
                    </p>
                  ) : (
                    departmentTrees.map((dept) => {
                      // Same curated columns the desktop mega panel uses, so
                      // a phone gets the whole category tree rather than a
                      // bare list of department names.
                      const cols = megaColumnsFor(dept.slug);
                      const open = mobileDept === dept.slug;
                      return (
                        <div
                          key={dept.slug}
                          className="border-t border-foreground/8 first:border-t-0"
                        >
                          <div className="flex items-stretch">
                            <Link
                              href={catalogueHref({ department: dept.slug })}
                              onClick={() => setIsMenuOpen(false)}
                              className="flex-1 px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold"
                            >
                              {dept.name}
                            </Link>
                            {cols?.length ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setMobileDept((d) =>
                                    d === dept.slug ? null : dept.slug,
                                  )
                                }
                                aria-label={`${open ? "Hide" : "Show"} ${dept.name} categories`}
                                aria-expanded={open}
                                className="px-6 py-4"
                              >
                                <ChevronDown
                                  className={cn(
                                    "w-4 h-4 transition-transform",
                                    open && "rotate-180",
                                  )}
                                />
                              </button>
                            ) : null}
                          </div>

                          {open && cols?.length ? (
                            <div className="bg-secondary/30 px-6 pb-4 pt-1 space-y-4">
                              {cols.map((col) => (
                                <div key={col.title}>
                                  <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-foreground/50 mb-1.5">
                                    {col.title}
                                  </p>
                                  <ul className="space-y-1">
                                    {col.links.map((l) => (
                                      <li key={l.label}>
                                        <Link
                                          href={`${catalogueHref({
                                            department: dept.slug,
                                            category: l.category || null,
                                            brand: l.brand || null,
                                          })}${
                                            l.subcategory
                                              ? `&subcategory=${encodeURIComponent(l.subcategory)}`
                                              : ""
                                          }`}
                                          onClick={() => setIsMenuOpen(false)}
                                          className="block py-1 text-[13px] text-foreground/75"
                                        >
                                          {l.label}
                                        </Link>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                    </div>
                </div>

            {/* Brands — temporarily hidden
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
                <div className="px-6 pb-5 space-y-3">
                  ...
            </div>
              )}
            </div>
            */}

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

            {/* About + Contact Us — moved to footer
            <div className="border-b border-foreground/8">
              <button type="button" className="...">About</button>
              ...
            </div>
            <Link href="/contact" ...>Contact Us</Link>
            */}

            {/* Mobile counterpart of the desktop Configurator link — see note
                above; the calculator now lives on the product page. */}
            {/* <Link
              href="/configurator"
              onClick={() => setIsMenuOpen(false)}
              className="block px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold border-b border-foreground/8"
            >
              Configurator
            </Link> */}
              </>
            )}

            <div className="px-6 py-6 space-y-4 bg-secondary/40">
              {isRealTradeAccount ? (
                <span className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] font-bold text-primary">
                  <Check className="w-4 h-4" />
                  Trade account · Active
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const turningOn = !isTradeMode;
                    toggleTradeMode();
                    toast[turningOn ? "success" : "info"](
                      turningOn
                        ? "Trade pricing activated — 5% off every product"
                        : "Trade pricing switched off",
                    );
                    setIsMenuOpen(false);
                    router.push("/");
                  }}
                  className={cn(
                    "flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] font-bold",
                    mounted && isTradeMode ? "text-primary" : "",
                  )}
                >
                  {mounted && isTradeMode ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <BadgePercent className="w-4 h-4" />
                  )}
                  {mounted && isTradeMode
                    ? "Trade pricing on · Exit"
                    : "Trade account"}
                </button>
              )}
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
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold opacity-60 mb-3">
              Call our Sales &amp; Technical Support Team
            </p>
            <Link
              href="tel:02046342203"
              className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.18em]"
            >
              <Phone className="w-4 h-4" /> 020 4634 2203
            </Link>
            <a
              href="mailto:info@linxsquare.co.uk"
              className="mt-3 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.18em]"
            >
              <Mail className="w-4 h-4" /> info@linxsquare.co.uk
            </a>
            <Link
              href="/help"
              className="mt-3 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.18em]"
            >
              <LifeBuoy className="w-4 h-4" /> Help &amp; Support
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

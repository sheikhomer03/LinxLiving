/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/refs */
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
  Loader2,
  BadgePercent,
  Check,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { megaColumnsFor, type MegaColumn } from "@/lib/megaMenu";
import { storefrontBrandLabel } from "@/lib/brandDisplay";
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
} from "@/lib/company";
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
import { SearchTakeover } from "./SearchTakeover";
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

/**
 * The announcement bar's messages.
 *
 * Lusso duplicates a single line so the carousel always has something to
 * slide to; ours carries three real ones, so the rotation says something new
 * each time rather than animating between identical copies.
 */
const ANNOUNCEMENTS: { text: string; href?: string; linkLabel?: string }[] = [
  {
    text: "FOR EXCLUSIVE TERMS CALL:",
    href: `tel:${DEFAULT_SUPPORT_PHONE.replace(/\s/g, "")}`,
    linkLabel: DEFAULT_SUPPORT_PHONE,
  },
  { text: "FREE SAMPLES ON EVERY RANGE — SEE THE FINISH BEFORE YOU COMMIT" },
  {
    text: "TRADE ACCOUNTS OPEN ON APPLICATION",
    href: "/linx-distribution",
    linkLabel: "LINX SQUARE DISTRIBUTION",
  },
];

const SUPPORT_PHONE = DEFAULT_SUPPORT_PHONE;
const SUPPORT_EMAIL = DEFAULT_SUPPORT_EMAIL;

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

/**
 * Drop menu links the department cannot currently show.
 *
 * MEGA_MENU is hand-written, so a link outlives its stock. Hiding the
 * Sterlingbuild brand emptied `flashings`, `sun-tunnels`, `blinds-and-shutters`
 * and `windows-and-doors` while their menu entries stayed, each opening a page
 * with nothing on it. The department payload carries the slugs it can actually
 * show, so the panel filters itself and the problem cannot come back by hand.
 *
 * A department that reports no slugs at all is left untouched: that means the
 * data did not load, and hiding the whole menu would be worse than showing it.
 */
function withStockedLinksOnly(
  columns: MegaColumn[] | null,
  dept: { stockedCategories?: string[]; stockedSubCategories?: string[] } | undefined,
): MegaColumn[] | null {
  if (!columns) return columns;
  const cats = new Set(dept?.stockedCategories || []);
  const subs = new Set(dept?.stockedSubCategories || []);
  if (!cats.size && !subs.size) return columns;

  const has = (value: string | undefined, pool: Set<string>) =>
    !value || value.split(",").some((slug) => pool.has(slug.trim()));

  return columns
    .map((column) => ({
      ...column,
      links: column.links.filter(
        (link) =>
          has(link.category, cats) && has(link.subcategory, subs),
      ),
    }))
    .filter((column) => column.links.length > 0);
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
      {/* No per-column cap: a column taller than 14rem used to scroll inside
          itself, hiding items behind a scrollbar. The panel keeps its own
          viewport-height guard, so the menu still cannot run off screen. */}
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={`${item.label}-${item.note || ""}-${item.href}-${index}`}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className="text-[12.5px] text-foreground hover:underline underline-offset-4 leading-snug"
            >
              {item.label}
              {item.note ? (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground no-underline">
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


export function Navbar({
  initialBrandMenus,
  initialDepartments,
  initialStoreName,
  overlay = false,
}: {
  initialBrandMenus?: BrandWithMenus[];
  initialDepartments?: DepartmentNode[];
  initialStoreName?: string;
  /**
   * Render white-on-image over the page instead of on a white ground.
   *
   * Lusso Stone's header is transparent on every template, because every one
   * of their templates opens on a full-bleed image. Ours do not — a login
   * form or a FAQ page behind a dark scrim would just look broken — so the
   * page opts in. The grid, the type and the mega panel are identical either
   * way; only the ink and the ground change.
   *
   * A page that sets this must also pull its first section up under the
   * header, the way Lusso's `#MainContent` negative margin does.
   */
  overlay?: boolean;
}) {
  // Original navigation. A retail-style alternative (department tabs +
  // sub-category strip + filter columns) is parked in
  // components/layout/NavbarShop.tsx and is not wired in.
  return (
    <NavbarContent
      initialBrandMenus={initialBrandMenus}
      initialDepartments={initialDepartments}
      initialStoreName={initialStoreName}
      overlay={overlay}
    />
  );
}

function NavbarContent({
  initialBrandMenus,
  initialDepartments,
  initialStoreName,
  overlay = false,
}: {
  initialBrandMenus?: BrandWithMenus[];
  initialDepartments?: DepartmentNode[];
  initialStoreName?: string;
  overlay?: boolean;
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
  const [announceIndex, setAnnounceIndex] = useState(0);
  /** Which department's categories are expanded in the mobile drawer. */
  const [mobileDept, setMobileDept] = useState<string | null>(null);
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
     
  }, [initialBrandMenus]);

  useEffect(() => {
    if (!initialDepartments?.length) return;
    const next = dedupeDepartments(initialDepartments);
    setDepartmentTrees(next);
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
  }, [pathname]);

  /*
   * Announcement rotation. Lusso slides every five seconds; a single message
   * has nothing to rotate to, so the timer does not start in that case.
   */
  useEffect(() => {
    if (ANNOUNCEMENTS.length < 2) return;
    const id = setInterval(
      () => setAnnounceIndex((i) => (i + 1) % ANNOUNCEMENTS.length),
      5000,
    );
    return () => clearInterval(id);
  }, []);

  // `mounted` gates this on the client-only session resolution — during SSR
  // (and the client's very first paint before hydration) the session context
  // can be unresolved, so both sides must agree on "/login" until mounted,
  // or React flags a hydration mismatch the moment the real status differs.
  const accountHref =
    mounted && status === "authenticated"
      ? (session?.user as any)?.role === "admin"
        ? "/admin"
        : "/profile"
      : "/login";

  const openTab = (tab: MegaTab) => setActiveTab(tab);
  const closeMega = () => setActiveTab(null);

  /*
   * The header goes solid for any of Lusso's three triggers: scrolled past,
   * a mega panel open, or the search modal open. Hover is the fourth, and it
   * is handled in CSS so it costs no re-render.
   */
  const isSolid = isScrolled || Boolean(activeTab) || isSearchOpen;

  return (
    <header className="fixed left-0 right-0 top-0 z-50">
      {/* Dimmer behind an open mega panel — z-40, so the header (z-50) and
          the panel stay above it. */}
      {activeTab && (
        <button
          type="button"
          aria-label="Close menu"
          className="hidden lg:block fixed inset-0 z-40 bg-black/30 cursor-default"
          onClick={closeMega}
        />
      )}

      {/*
        1 — Announcement bar.

        Lusso runs a 30px black strip above everything, carrying one message
        that slides horizontally between duplicates. Ours rotates through the
        real contact routes rather than repeating a single line, but the bar
        itself — height, ground, centred 10px caps — is theirs.
      */}
      <div
        className="relative z-50 flex items-center justify-center overflow-hidden bg-black text-white"
        style={{ height: "var(--lx-announce-h)" }}
        role="region"
        aria-label="Announcement"
      >
        {ANNOUNCEMENTS.map((item, index) => (
          <p
            key={item.text}
            aria-hidden={index !== announceIndex}
            className={cn(
              "font-menu absolute inset-0 flex items-center justify-center gap-1.5 px-4 text-center text-[10px] tracking-[0.1em] transition-transform duration-300 ease-out",
              index === announceIndex
                ? "translate-x-0"
                : index < announceIndex
                  ? "-translate-x-full"
                  : "translate-x-full",
            )}
          >
            {item.text}
            {item.href ? (
              <Link
                href={item.href}
                className="underline-offset-2 hover:underline"
              >
                {item.linkLabel}
              </Link>
            ) : null}
          </p>
        ))}
      </div>

      {/*
        2 — The header proper. `data-overlay` picks white-on-image versus
        white-ground; `data-solid` is the scrolled / menu-open state that
        forces the solid treatment even in overlay mode. Both are read by
        .lx-header-wrapper in globals.css.
      */}
      <div
        className="lx-header-wrapper relative z-50"
        data-overlay={overlay ? "true" : "false"}
        data-solid={isSolid ? "true" : "false"}
        onMouseLeave={() => {
          if (typeof window !== "undefined" && window.innerWidth >= 1024) {
            closeMega();
          }
        }}
      >
        <div className="site-container lx-header">
          {/* Row 1, columns 1-2: search and the phone number. */}
          <div className="lx-header__start flex min-w-0 flex-1 items-center gap-1 lg:flex-none">
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              className="inline-flex lx-header-icon lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="stroke-[1.5]" />
            </button>

            <button
              type="button"
              onClick={() => {
                closeMega();
                setIsSearchOpen((v) => !v);
              }}
              className="lx-menu-type flex items-center gap-2 whitespace-nowrap"
              style={{ color: "var(--lx-header-ink)" }}
              aria-expanded={isSearchOpen}
              aria-label="Search"
            >
              <span className="inline-flex lx-header-icon w-8 lg:w-5">
                <Search className="stroke-[1.5]" />
              </span>
              <span className="hidden lg:inline">Search</span>
            </button>

            <a
              href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`}
              className="lx-menu-type hidden whitespace-nowrap lg:inline"
              style={{ color: "var(--lx-header-ink)" }}
            >
              {SUPPORT_PHONE}
            </a>
          </div>

          {/* Row 1, columns 6-7: the logo, dead centre of twelve. */}
          <span className="lx-header__heading shrink-0">
            <Link href="/" aria-label={storeName}>
              {/*
                The mark takes its ink from the same custom property as the
                rest of the header rather than from a React-computed variant.
                Hover is a CSS-only state — it flips the header to solid
                without a re-render — so a `variant` prop decided in JS would
                leave a white wordmark sitting on the white ground for as long
                as the pointer was over the bar.
              */}
              <BrandLogo
                name={storeName}
                size="header"
                className="text-[color:var(--lx-header-ink)]"
              />
            </Link>
          </span>

          {/* Row 1, columns 8-12: contact, then the icon cluster. */}
          <div className="lx-header__end flex min-w-0 flex-1 items-center justify-end gap-0.5 lg:flex-none">
            <Link
              href="/contact"
              className="lx-menu-type mr-2 hidden whitespace-nowrap sm:inline"
              style={{ color: "var(--lx-header-ink)" }}
            >
              Contact
            </Link>

            <button
              type="button"
              onClick={openWishlist}
              className="hidden lx-header-icon sm:inline-flex"
              aria-label="Open wishlist"
            >
              <Heart className="stroke-[1.5]" />
              {mounted && wishlistItems.length > 0 && (
                <span className="lx-count-bubble">{wishlistItems.length}</span>
              )}
            </button>

            <Link
              href={accountHref}
              className="hidden lx-header-icon sm:inline-flex"
              aria-label={
                mounted && status === "authenticated" ? "Account" : "Log in"
              }
            >
              <User className="stroke-[1.5]" />
            </Link>

            <button
              type="button"
              onClick={openCart}
              className="inline-flex lx-header-icon"
              aria-label="Open cart"
            >
              <ShoppingBag className="stroke-[1.5]" />
              {mounted && getTotalItems() > 0 && (
                <span className="lx-count-bubble">{getTotalItems()}</span>
              )}
            </button>
          </div>

          {/* Row 2: the nav, spanning all twelve columns, centred. */}
          <nav className="lx-header__nav hidden lg:flex" aria-busy={menusLoading}>
            <Link
              href="/"
              onMouseEnter={closeMega}
              className="lx-menu-type lx-nav-item font-menu"
              data-active={pathname === "/" && !activeTab ? "true" : "false"}
            >
              Home
            </Link>
            {departmentTrees.map((dept) => {
              const tab = `dept:${dept.slug}`;
              return (
                <Link
                  key={dept.slug || dept._id}
                  href={catalogueHref({ department: dept.slug })}
                  onMouseEnter={() => openTab(tab)}
                  onFocus={() => openTab(tab)}
                  onClick={closeMega}
                  className="lx-menu-type lx-nav-item font-menu whitespace-nowrap"
                  data-active={activeTab === tab ? "true" : "false"}
                  aria-expanded={activeTab === tab}
                >
                  {dept.name}
                </Link>
              );
            })}
            <Link
              href="/category?onSale=1"
              onMouseEnter={closeMega}
              className="lx-menu-type lx-nav-item font-menu whitespace-nowrap"
              data-active={
                pathname === "/category" && !activeTab ? "true" : "false"
              }
            >
              Sale
            </Link>
          </nav>
        </div>

        {/* Mega panel */}
        <div
          className={cn(
            // The panel is part of the menu, so it is set in the menu face
            // throughout rather than dropping back to body type halfway down
            // a dropdown. Sizes inside stay as they were.
            "font-menu absolute left-0 right-0 top-full z-20 bg-white border-b border-foreground/10 shadow-[0_28px_70px_rgba(0,0,0,0.1)] transition-all duration-300",
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
              const curatedEarly = withStockedLinksOnly(megaColumnsFor(dept.slug), dept as never);
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
                    <div className="grid grid-cols-2 gap-x-8 gap-y-7 md:grid-cols-3 lg:grid-cols-6">
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
                                  className="text-[12px] text-foreground hover:underline underline-offset-4 leading-snug"
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
              const curated = withStockedLinksOnly(megaColumnsFor(dept.slug), dept as never);
              if (curated) {
                return (
                  <div className="site-container py-8">
                    <div className="flex flex-wrap items-start gap-x-10 gap-y-8 lg:flex-nowrap">
                      <div className="grid flex-1 grid-cols-2 gap-x-8 gap-y-7 md:grid-cols-3 lg:grid-cols-6">
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
                                className="text-[12px] text-foreground hover:underline underline-offset-4 leading-snug"
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

      {/*
        3 — Search.

        Not a dropdown: Lusso's search covers the whole viewport, announcement
        bar and nav included, so it lives in its own component rather than as
        a strip hung off the header. Trending searches are the departments —
        the shortcuts we can offer without a list anyone has to maintain.
      */}
      <SearchTakeover
        open={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        trending={departmentTrees.map((dept) => ({
          label: dept.name,
          href: catalogueHref({ department: dept.slug }),
        }))}
      />

      {/*
        5 — Mobile drawer. Lusso overlays from the left and pushes through
        tiers; this keeps the existing accordion, restyled to the same ink.
      */}
      <div
        className={cn(
          "fixed inset-0 z-100 transition-all duration-500 lg:hidden",
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
            "absolute left-0 top-0 flex h-full w-[88%] max-w-sm flex-col bg-white shadow-2xl transition-transform duration-500 ease-out",
            isMenuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between border-b border-foreground/8 px-6 py-5">
            <BrandLogo name={storeName} size="header" />
            <button
              type="button"
              onClick={() => setIsMenuOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-6 w-6 stroke-1" />
            </button>
          </div>

          {/* No search field in here. The reference drawer has none either —
              search is the magnifier in the header bar, which opens the
              full-screen panel, so a second field inside the menu was two
              ways into the same thing. */}
          <div className="flex-1 overflow-y-auto">
            {menusLoading ? (
              <div className="space-y-4 px-6 py-8">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-3 w-2/3 animate-pulse rounded-sm bg-foreground/8"
                  />
                ))}
                <span className="sr-only">Loading navigation</span>
              </div>
            ) : (
              <>
                <Link
                  href="/"
                  onClick={() => setIsMenuOpen(false)}
                  className="lx-menu-type font-menu block border-b border-foreground/8 px-6 py-4 text-black"
                >
                  Home
                </Link>

                {departmentTrees.length === 0 ? (
                  <p className="px-6 py-2 text-sm text-muted-foreground">
                    No departments yet.
                  </p>
                ) : (
                  departmentTrees.map((dept) => {
                    // Same curated columns the desktop mega panel uses, so
                    // a phone gets the whole category tree rather than a
                    // bare list of department names.
                    const cols = withStockedLinksOnly(
                      megaColumnsFor(dept.slug),
                      dept as never,
                    );
                    const open = mobileDept === dept.slug;
                    return (
                      <div
                        key={dept.slug}
                        className="border-b border-foreground/8"
                      >
                        <div className="flex items-stretch">
                          <Link
                            href={catalogueHref({ department: dept.slug })}
                            onClick={() => setIsMenuOpen(false)}
                            className="lx-menu-type font-menu flex-1 px-6 py-4 text-black"
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
                                  "h-4 w-4 transition-transform",
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
                                <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-foreground mb-1.5">
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
                                        className="block py-1 text-[13px] text-foreground"
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

                <Link
                  href="/category?onSale=1"
                  onClick={() => setIsMenuOpen(false)}
                  className="lx-menu-type font-menu block border-b border-foreground/8 px-6 py-4 text-black"
                >
                  Sale
                </Link>
                <Link
                  href="/contact"
                  onClick={() => setIsMenuOpen(false)}
                  className="lx-menu-type font-menu block border-b border-foreground/8 px-6 py-4 text-black"
                >
                  Contact
                </Link>
              </>
            )}

            <div className="space-y-4 bg-secondary/40 px-6 py-6">
              {/*
                Trade pricing.

                The reference header carries nothing like this, so it left the
                desktop bar with the rest of the utility strip. It stays here
                because it is real functionality with a real discount behind
                it, and the hero's own trade button (HeroTradeButton) is the
                only other way in.
              */}
              {isRealTradeAccount ? (
                <span className="lx-menu-type flex items-center gap-3 text-primary">
                  <Check className="h-4 w-4" />
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
                    "lx-menu-type font-menu flex items-center gap-3",
                    mounted && isTradeMode ? "text-primary" : "text-black",
                  )}
                >
                  {mounted && isTradeMode ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <BadgePercent className="h-4 w-4" />
                  )}
                  {mounted && isTradeMode
                    ? "Trade pricing on · Exit"
                    : "Trade account"}
                </button>
              )}
              <Link
                href={accountHref}
                onClick={() => setIsMenuOpen(false)}
                className="lx-menu-type font-menu flex items-center gap-3 text-black"
              >
                <User className="h-4 w-4" />
                {mounted && status === "authenticated"
                  ? session?.user?.name || "Account"
                  : "Log in / Register"}
              </Link>
              {mounted && status === "authenticated" && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setShowLogoutModal(true);
                  }}
                  className="lx-menu-type w-full bg-foreground py-3 text-background"
                >
                  Log out
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-foreground/8 px-6 py-5">
            <a
              href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`}
              className="lx-menu-type flex items-center gap-3 text-black"
            >
              <Phone className="h-4 w-4" /> {SUPPORT_PHONE}
            </a>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="lx-menu-type mt-3 flex items-center gap-3 text-black"
            >
              <Mail className="h-4 w-4" /> {SUPPORT_EMAIL}
            </a>
            <Link
              href="/help"
              onClick={() => setIsMenuOpen(false)}
              className="lx-menu-type mt-3 flex items-center gap-3 text-black"
            >
              <LifeBuoy className="h-4 w-4" /> Help &amp; Support
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

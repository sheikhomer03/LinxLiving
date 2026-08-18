import { getProductDisplayImage } from "@/lib/productImage";
import { formatDisplaySize } from "@/lib/sizeBuckets";
import { hasPaidSampleFlow } from "@/lib/priceOnRequest";

export type MoreFromProduct = {
  id: string;
  name: string;
  price: number;
  image?: string;
  category?: string;
  subCategory?: string;
  department?: string;
  brandName?: string;
  brandSlug?: string;
  pricePerM2?: number | null;
  shopifyVariantId?: string | null;
  stock?: number;
  priceMode?: string | null;
  salePercent?: number | null;
  compareAtPrice?: number | null;
  hasPaidSample?: boolean;
};

export type ProductSizeOption = {
  id: string;
  /** Raw specs.size value */
  size: string;
  /** Spectra-style label, e.g. "60 X 120" */
  label: string;
  price: number;
  isCurrent: boolean;
};

function productBaseTitle(
  name: string,
  specs?: {
    baseTitle?: string;
    basetitle?: string;
    spectraTitle?: string;
  },
): string {
  return String(
    specs?.baseTitle ||
      specs?.basetitle ||
      specs?.spectraTitle ||
      name
        .replace(/\s+\d+(\.\d+)?\s*[x×]\s*\d+(\.\d+)?(?:\s*mm)?$/i, "")
        .replace(/\s+\d+(\.\d+)?\s*cm\s*x\s*\d+(\.\d+)?\s*cm$/i, "") ||
      name,
  ).trim();
}

function productSize(specs?: { size?: string; Size?: string }): string {
  const raw = specs?.size || specs?.Size || "";
  return String(raw).trim();
}

/**
 * Build Spectra-style SIZE options for the PDP: current size plus same-range
 * siblings that differ only by size (linked as separate products in our DB).
 */
export function pickSizeOptions(
  products: Array<{
    _id: string;
    name: string;
    price: number;
    specs?: {
      baseTitle?: string;
      basetitle?: string;
      spectraTitle?: string;
      size?: string;
      Size?: string;
    };
  }>,
  current: {
    id: string;
    name: string;
    price: number;
    size?: string;
    baseTitle?: string;
    spectraTitle?: string;
  },
): ProductSizeOption[] {
  const currentSize = String(current.size || "").trim();
  if (!currentSize || currentSize.toLowerCase() === "n/a") return [];

  const currentBase = (
    current.baseTitle ||
    current.spectraTitle ||
    productBaseTitle(current.name)
  ).trim();

  const bySize = new Map<string, ProductSizeOption>();
  bySize.set(currentSize.toLowerCase(), {
    id: String(current.id),
    size: currentSize,
    label: formatDisplaySize(currentSize),
    price: Number(current.price) || 0,
    isCurrent: true,
  });

  for (const p of products) {
    if (String(p._id) === String(current.id)) continue;
    const size = productSize(p.specs);
    if (!size || size.toLowerCase() === "n/a") continue;
    const base = productBaseTitle(p.name, p.specs);
    if (base.toLowerCase() !== currentBase.toLowerCase()) continue;
    const key = size.toLowerCase();
    if (bySize.has(key)) continue;
    bySize.set(key, {
      id: String(p._id),
      size,
      label: formatDisplaySize(size),
      price: Number(p.price) || 0,
      isCurrent: false,
    });
  }

  return [...bySize.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
}

/** Group products by baseTitle (fallback: name without size), pick one each. */
export function pickMoreFromProducts(
  products: Array<{
    _id: string;
    name: string;
    price: number;
    images?: unknown;
    category?: string;
    subCategory?: string;
    department?: string;
    stock?: number;
    shopifyVariantId?: string | null;
    specs?: {
      baseTitle?: string;
      basetitle?: string;
      pricePerM2?: number | string;
      source?: string;
      naturaHandle?: string;
      salePercent?: number;
      salePriceMode?: string;
      priceDisplay?: string;
      compareAtPrice?: number | string;
      shopifyCompareAt?: number | string;
      samplePrice?: number;
      ottoId?: unknown;
      ottoHandle?: unknown;
    };
    brandName?: string;
    brandSlug?: string;
  }>,
  current: { id: string; baseTitle?: string; name: string },
  limit = 3,
): MoreFromProduct[] {
  const currentBase = (
    current.baseTitle ||
    current.name.replace(/\s+\d+(\.\d+)?\s*cm\s*x\s*\d+(\.\d+)?\s*cm$/i, "") ||
    current.name
  ).trim();

  const seen = new Set<string>();
  const picked: MoreFromProduct[] = [];

  for (const p of products) {
    if (String(p._id) === String(current.id)) continue;
    const base = String(
      p.specs?.baseTitle ||
        p.specs?.basetitle ||
        p.name.replace(/\s+\d+(\.\d+)?\s*cm\s*x\s*\d+(\.\d+)?\s*cm$/i, "") ||
        p.name,
    ).trim();
    if (base.toLowerCase() === currentBase.toLowerCase()) continue;
    const key = base.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const m2 = Number(p.specs?.pricePerM2);
    // Same "raise-then-percent" carve-out as the category grid (Category
    // Template) — when the sale is driven purely by salePercent, the raised
    // compare-at figure isn't a genuine "was" price and must not show.
    const raiseThenPercent =
      String(p.specs?.salePriceMode || "") === "raise-then-percent";
    const compareRaw = p.specs?.shopifyCompareAt ?? p.specs?.compareAtPrice;
    const compareAt =
      !raiseThenPercent &&
      compareRaw != null &&
      Number(compareRaw) > Number(p.price)
        ? Number(compareRaw)
        : null;
    const salePercent =
      typeof p.specs?.salePercent === "number" ? p.specs.salePercent : null;
    picked.push({
      id: String(p._id),
      name: base || p.name,
      price: Number(p.price) || 0,
      image: getProductDisplayImage(p.images as any) || undefined,
      category: p.category,
      subCategory: p.subCategory,
      department: p.department,
      brandName: p.brandName,
      brandSlug: p.brandSlug,
      pricePerM2: Number.isFinite(m2) && m2 > 0 ? m2 : null,
      shopifyVariantId: p.shopifyVariantId,
      stock: p.stock ?? 0,
      priceMode: p.specs?.priceDisplay || null,
      salePercent,
      compareAtPrice: compareAt,
      hasPaidSample: hasPaidSampleFlow(p.specs as Record<string, unknown>),
    });
    if (picked.length >= limit) break;
  }

  return picked;
}

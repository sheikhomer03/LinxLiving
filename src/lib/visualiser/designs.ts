/* eslint-disable @typescript-eslint/no-explicit-any -- lean Mongo documents, as in actions/products.ts */
/**
 * Server side of the visualiser's design list and design cards.
 *
 * Used by /api/visualiser/designs and by the /visualiser page itself, so a
 * card is built one way whichever of them asked for it. Each card's props are
 * derived exactly as the Flooring department grid derives them
 * (CategoryTemplate), so prices match the catalogue to the penny.
 */
import { getPublicProduct, getPublicProducts } from "@/app/actions/products";
import { getBrandMenuTrees } from "@/app/actions/admin";
import { LISTING_FIELDS, LISTING_IMAGE_SLICE } from "@/lib/listingQuery";
import { getListingFirstPage } from "@/lib/cachedListing";
import { getProductDisplayImage } from "@/lib/productImage";
import { hasPaidSampleFlow } from "@/lib/priceOnRequest";
import {
  VISUALISER_DEPARTMENT,
  VISUALISER_EXCLUDED_CATEGORIES,
  VISUALISER_EXCLUDED_NAME_PATTERN,
  VISUALISER_EXCLUDED_SUBCATEGORIES,
  toVisualiserDesign,
} from "@/lib/visualiser/flooring";
import { DESIGN_TYPES, DESIGNS_PAGE_SIZE, type DesignsQuery } from "@/lib/visualiser/designsQuery";
import type {
  VisualiserDesignCard,
  VisualiserDesignsResponse,
} from "@/lib/visualiser/types";

/** What a design card reads beyond the listing's own fields. */
const DESIGN_FIELDS = [
  LISTING_FIELDS,
  "categories",
  "subCategories",
  "dimensions",
  "packCoverageM2",
  "finish",
  "specs.finish",
  "specs.sqmPerBox",
  "specs.packCoverage",
  "specs.packCoverageM2",
].join(" ");

/** `name`: storefront label (cards); `rawName`: registry name (calculators, as the product page passes). */
type BrandIndex = Map<string, { name: string; rawName?: string; slug?: string }>;

/** Brand id → display name and slug, as the product page labels brands. */
export async function getBrandIndex(): Promise<BrandIndex> {
  const res = await getBrandMenuTrees();
  const index: BrandIndex = new Map();
  for (const b of (res?.brands || []) as any[]) {
    if (!b?._id) continue;
    const name =
      String(b.displayName || "").trim() ||
      String(b.uiName || "").trim() ||
      String(b.name || "").trim();
    index.set(String(b._id), { name, rawName: String(b.name || "").trim() || undefined, slug: b.slug || undefined });
  }
  return index;
}

/** One product → its design and card, or null when the visualiser cannot lay it. */
export function buildDesignCard(product: any, brands: BrandIndex): VisualiserDesignCard | null {
  const design = toVisualiserDesign(product);
  if (!design) return null;

  const specs = product.specs || {};
  const brandId = product.brand
    ? String(typeof product.brand === "object" ? product.brand._id || product.brand : product.brand)
    : "";
  const brand = brands.get(brandId);
  const compareRaw = specs.shopifyCompareAt ?? specs.compareAtPrice;
  const compareAt = compareRaw != null && Number(compareRaw) > 0 ? Number(compareRaw) : null;
  // Raise-then-%: price is the raised actual; only salePercent discounts.
  const raiseThenPercent = String(specs.salePriceMode || "") === "raise-then-percent";
  const salePercent = typeof specs.salePercent === "number" ? specs.salePercent : null;

  return {
    design,
    card: {
      id: String(product._id),
      name: String(product.name || ""),
      price: Number(product.price) || 0,
      category: product.category || "Product",
      subCategory: product.subCategory || undefined,
      department: product.department || undefined,
      brandName: brand?.name || undefined,
      brandSlug: brand?.slug,
      priceMode: specs.priceDisplay || undefined,
      pricePerM2: Number(specs.pricePerM2) > 0 ? Number(specs.pricePerM2) : null,
      size: specs.size || undefined,
      hasPaidSample: hasPaidSampleFlow(specs),
      salePercent,
      compareAtPrice: raiseThenPercent
        ? null
        : compareAt != null && compareAt > Number(product.price)
          ? compareAt
          : null,
      vatRate: product.vatRate == null ? 20 : Number(product.vatRate),
      image: getProductDisplayImage(product.images),
      images: product.images ?? null,
      shopifyImages: product.shopifyImages ?? null,
      stock: typeof product.stock === "number" ? product.stock : undefined,
      shopifyVariantId: product.shopifyVariantId || undefined,
    },
  };
}

/**
 * The customer's saved designs, in the order they saved them. Each product
 * goes through the same public lookup as its product page, so a hidden,
 * unpriced or deleted product simply drops out, as does anything that is not
 * visualisable flooring.
 */
async function fetchDesignsByIds(ids: string[]): Promise<VisualiserDesignsResponse> {
  const [products, brands] = await Promise.all([
    Promise.all(ids.map((id) => getPublicProduct(id).catch(() => null))),
    getBrandIndex(),
  ]);
  const designs: VisualiserDesignCard[] = [];
  for (const product of products) {
    const item = product ? buildDesignCard(product, brands) : null;
    if (item) designs.push(item);
  }
  return { designs, page: 1, total: designs.length, totalPages: designs.length ? 1 : 0 };
}

/** One page of visualisable flooring designs (or the saved ones, with `ids`). */
export async function fetchDesignsPage(query: DesignsQuery): Promise<VisualiserDesignsResponse> {
  if (query.ids) return fetchDesignsByIds(query.ids);

  const typeDef = DESIGN_TYPES.find((t) => t.key === query.type);
  const listing: Parameters<typeof getPublicProducts>[0] = {
    department: VISUALISER_DEPARTMENT,
    // Only products actually filed under Flooring — the product page's
    // button uses the same rule, so every design listed here has one.
    departmentStrict: true,
    category: typeDef && "category" in typeDef ? [...typeDef.category] : undefined,
    subCategory: typeDef && "subCategory" in typeDef ? [...typeDef.subCategory] : undefined,
    search: query.q || undefined,
    sort: query.sort,
    page: query.page,
    limit: DESIGNS_PAGE_SIZE,
    requireImages: true,
    fields: DESIGN_FIELDS,
    imageSlice: LISTING_IMAGE_SLICE,
    excludeCategory: VISUALISER_EXCLUDED_CATEGORIES,
    excludeSubCategory: VISUALISER_EXCLUDED_SUBCATEGORIES,
    excludeNamePattern: VISUALISER_EXCLUDED_NAME_PATTERN,
  };
  // Cached the way the Flooring department is: the landing view (page 1,
  // no search) through the shared first-page cache, everything else through
  // getPublicProducts' own 30 s cache — both tagged "catalogue-listing", so an
  // admin change clears them together.
  const firstView = query.page === 1 && !query.q;
  const [result, brands] = await Promise.all([
    firstView ? getListingFirstPage(listing) : getPublicProducts(listing),
    getBrandIndex(),
  ]);

  const designs: VisualiserDesignCard[] = [];
  for (const product of (result.products || []) as any[]) {
    const item = buildDesignCard(product, brands);
    if (item) designs.push(item);
  }
  return {
    designs,
    page: Number(result.page) || query.page,
    total: Number(result.total) || 0,
    totalPages: Number(result.totalPages) || 0,
  };
}

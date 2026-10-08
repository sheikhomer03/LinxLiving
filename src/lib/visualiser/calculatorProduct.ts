/* eslint-disable @typescript-eslint/no-explicit-any -- lean Mongo documents, as in actions/products.ts */
/**
 * What the visualiser's quantity calculator needs to price one product —
 * built with exactly the expressions the product page uses for the same
 * fields (src/app/products/[id]/page.tsx, the `product={{…}}` passed to
 * ProductSection), so the visualiser quotes the same packs and totals.
 *
 * Only the fields the flooring calculators read are carried: if the product
 * page changes how one of these is derived, change it here too.
 */
import { getProductGalleryImages, resolveGalleryImages } from "@/lib/productImage";
import {
  hasUfhsConfigurator,
  parseCoverage,
  parseDoTheJobRight,
  parseOptionFields,
  parseShopifyOptions,
  parseUfhsVariants,
} from "@/lib/productUfhsSections";

/** Same lookup as the product page's own pickSpec (scalars, any key case). */
function pickSpec(specs: Record<string, unknown> | undefined, key: string) {
  if (!specs) return undefined;
  const direct = specs[key];
  if (direct != null && String(direct).trim()) return String(direct);
  const lower = Object.entries(specs).find(([k]) => k.toLowerCase() === key.toLowerCase());
  if (lower?.[1] != null && String(lower[1]).trim()) return String(lower[1]);
  return undefined;
}

const numberOrNull = (raw: unknown) => {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export type CalculatorProduct = {
  id: string;
  /** Storefront address — the "view product" link goes by slug. */
  slug?: string;
  name: string;
  price: number;
  /** Cart line image: the gallery's first entry, as the product page adds it. */
  image: string;
  category: string;
  subCategory?: string;
  department?: string;
  brandName?: string;
  brandSlug?: string;
  priceMode?: string;
  stock: number;
  shopifyVariantId?: string;
  sku?: string;
  productCode?: string;
  size?: string;
  sqmPerBox?: string;
  pricePerM2: number | null;
  packCoverageM2: number | null;
  pricePerPack: number | null;
  priceIsPerSqm: boolean;
  tilesPerSqm: number | null;
  /** Otto Tiles: tiles in one box, sample price and lead time. */
  tilesPerBox: number | null;
  samplePrice: number | null;
  leadTimeLabel: string | null;
  leadTimeDetail: string | null;
  orderUnit?: string;
  minFullPack: boolean;
  unitPrice: number | null;
  sheetPricePerM2: number | null;
  salePercent: number | null;
  compareAtPrice: number | null;
  soldPerUnit: boolean;
  addonGroups: unknown[];
  catalogVariants: any[];
  /** Option axes (Colour / Size / Finish), as the product page parses them. */
  shopifyOptions: { name: string; position?: number; values?: string[] }[];
  /** Porcious-style delivery-zone pricing (priced by its own configurator). */
  hasZonePricing: boolean;
  /** Under Floor Heating store item sold per option + quantity (UfhsConfigurator). */
  hasUfhsConfig: boolean;
};

/** `brand` is the brand registry entry the product page matches by id. */
export function buildCalculatorProduct(
  product: any,
  brand: { name?: string; slug?: string } | null,
): CalculatorProduct {
  const specs = (product.specs || {}) as Record<string, unknown>;
  const saleRaw = pickSpec(specs, "salePercent");
  const images = getProductGalleryImages(resolveGalleryImages(product));

  return {
    id: String(product._id),
    slug: product.slug ? String(product.slug) : undefined,
    name: String(product.name || ""),
    price: Number(product.price) || 0,
    image: images[0] || "",
    category: product.category,
    subCategory: product.subCategory || undefined,
    department: product.department || undefined,
    brandName: brand?.name,
    brandSlug: brand?.slug,
    priceMode: pickSpec(specs, "priceDisplay") || undefined,
    stock: product.stock ?? 0,
    shopifyVariantId: product.shopifyVariantId,
    sku: pickSpec(specs, "sku"),
    productCode: pickSpec(specs, "productCode"),
    size: pickSpec(specs, "size"),
    sqmPerBox: pickSpec(specs, "sqmPerBox") || pickSpec(specs, "Pack Coverage") || pickSpec(specs, "packCoverage"),
    pricePerM2: (() => {
      const raw = pickSpec(specs, "pricePerM2");
      if (raw == null || raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    packCoverageM2: numberOrNull(
      pickSpec(specs, "packCoverageM2") ||
        pickSpec(specs, "sqmPerBox") ||
        pickSpec(specs, "Pack Coverage") ||
        pickSpec(specs, "packCoverage") ||
        pickSpec(specs, "Pack Size"),
    ),
    pricePerPack: numberOrNull(
      pickSpec(specs, "pricePerPack") ||
        pickSpec(specs, "Price Per Pack") ||
        // Flooring Sales quotes the pack price as the product price.
        (pickSpec(specs, "fslSlug") ? String(product.price) : ""),
    ),
    priceIsPerSqm: /per\s*m2|per\s*m²/i.test(
      String(pickSpec(specs, "unit") ?? pickSpec(specs, "priceUnit") ?? ""),
    ),
    tilesPerSqm: numberOrNull(
      pickSpec(specs, "tilesPerSqm") ||
        pickSpec(specs, "pcsIn1Sqm") ||
        pickSpec(specs, "Tiles per m2") ||
        pickSpec(specs, "Tiles per m²"),
    ),
    tilesPerBox: numberOrNull(
      pickSpec(specs, "tilesPerBox") ||
        pickSpec(specs, "pcsIn1Box") ||
        pickSpec(specs, "Tiles / Box") ||
        pickSpec(specs, "Tiles per Box"),
    ),
    samplePrice: numberOrNull(pickSpec(specs, "samplePrice") || pickSpec(specs, "Sample Price")),
    leadTimeLabel: (() => {
      const raw =
        product.stockAvailabilityText ||
        pickSpec(specs, "leadTimeLabel") ||
        pickSpec(specs, "Lead Time") ||
        pickSpec(specs, "stockStatusLabel") ||
        pickSpec(specs, "stockAvailability");
      return raw != null && String(raw).trim() ? String(raw).trim() : null;
    })(),
    leadTimeDetail: (() => {
      const raw =
        pickSpec(specs, "leadTimeDetail") ||
        pickSpec(specs, "Estimated Ship") ||
        pickSpec(specs, "shippingEstimate");
      return raw != null && String(raw).trim() ? String(raw).trim() : null;
    })(),
    orderUnit: pickSpec(specs, "orderUnit") || undefined,
    minFullPack: /^(true|1|yes)$/i.test(pickSpec(specs, "minFullPack") ?? ""),
    unitPrice: (() => {
      const n = Number(pickSpec(specs, "unitPrice"));
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    sheetPricePerM2: (() => {
      const n = Number(pickSpec(specs, "sheetPricePerM2"));
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    salePercent: saleRaw != null && !Number.isNaN(Number(saleRaw)) ? Number(saleRaw) : null,
    compareAtPrice: (() => {
      // Raise-then-%: price is already the raised actual; salePercent applies
      // the off. compareAt === price would hide the sale.
      if (String(pickSpec(specs, "salePriceMode") || "") === "raise-then-percent") return null;
      const raw = pickSpec(specs, "shopifyCompareAt") || pickSpec(specs, "compareAtPrice");
      if (raw == null || raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    soldPerUnit: Boolean(product.soldPerUnit),
    addonGroups: Array.isArray(product.addonGroups) ? product.addonGroups : [],
    catalogVariants: Array.isArray(product.variants) ? product.variants : [],
    shopifyOptions: parseShopifyOptions(product.shopifyOptions) as CalculatorProduct["shopifyOptions"],
    hasZonePricing: Boolean(specs.zonePricing && typeof specs.zonePricing === "object"),
    // ProductSection's isUfhs && hasUfhsConfigurator(…), from the same parsed fields.
    hasUfhsConfig:
      (brand?.slug === "the-under-floor-heating" || /under.?floor.?heating/i.test(String(brand?.name || ""))) &&
      hasUfhsConfigurator({
        coverage: parseCoverage(product.coverage),
        nestedOptions: parseOptionFields(product.nestedOptions),
        doTheJobRight: parseDoTheJobRight(product.doTheJobRight),
        shopifyOptions: parseShopifyOptions(product.shopifyOptions),
        variants: (() => {
          const fromField = parseUfhsVariants(product.variants);
          return fromField.length ? fromField : parseUfhsVariants(specs.ufhsVariants);
        })(),
      }),
  };
}

import { isAreaSoldCategory } from "@/lib/tileCalculator";
import { hasPaidSampleFlow, isPriceOnRequest } from "@/lib/priceOnRequest";
import { isSpectraAdhesiveGroutCategory } from "@/lib/spectraLarsenCalculator";

/**
 * Which products come with a free sample.
 *
 * One rule for every place that asks — the FREE SAMPLE badge on cards and the
 * product page, the free sample line the cart adds under a product, and the
 * checkout that re-checks it against Mongo before putting a £0 line on the
 * order — so the badge, the basket and the order can never disagree.
 *
 * It reads only what is stored on the product (no browser state), so the
 * server can apply it exactly as the page does. The product page's own
 * area-calculator test is the source: a priced tile / flooring / paving
 * product sold by area, minus everything that is not a surface someone would
 * sample (adhesive, grout, trims, heating, units) and anything whose sample
 * is charged for (Otto Tiles).
 */

/** Tiles-department categories that are consumables, not a tile to sample. */
export const TILE_ACCESSORY_CATEGORIES = [
  "grout",
  "glitter-grout",
  "tile-adhesive",
  "sealing-and-cleaning",
  "tiletrim",
  "spacers",
  "tiling-tools",
  "tiling-preparation",
  "silicone",
];

/** Departments with nothing to sample: units, kits and consumables. */
const NOT_AREA_DEPARTMENTS = new Set([
  "heating",
  "bathrooms",
  "rooflights-and-glass",
  "kitchens",
  "accessories",
]);

/**
 * Outside the tile / flooring / outdoor departments, a category that names
 * a unit or a consumable is not a surface — even when a coverage spec or a
 * keyword ("ceramic") makes it look sold by area. Tap Warehouse's
 * "Bathroom Furniture" and "Kitchen Sinks" carry no department at all.
 * (Inside those departments "bathroom-tiles" / "kitchen-tiles" are surfaces,
 * which is why this is not applied there.)
 */
const NOT_A_SURFACE =
  /furniture|sink|basin|tool|abrasive|accessor|adhesive|grout|silicone|sealant|cleaning/i;

/** Departments whose priced products are sold by area. */
const AREA_DEPARTMENTS = new Set(["tiles", "flooring", "outdoor-living"]);

export type FreeSampleInput = {
  price?: number | null;
  brandName?: string | null;
  brandSlug?: string | null;
  /** `specs.priceDisplay` — "from" makes a product enquiry-only. */
  priceMode?: string | null;
  department?: string | null;
  category?: string | null;
  subCategory?: string | null;
  /** Menu label of the category, when the caller has it. */
  categoryName?: string | null;
  /** Product specs — read for the paid-sample signals. */
  specs?: Record<string, unknown> | null;
  /** Already-computed `hasPaidSampleFlow(specs)`, for callers without specs. */
  hasPaidSample?: boolean | null;
  /** `soldPerUnit`, or a pergola size table — a unit, not an area. */
  soldPerUnit?: boolean | null;
  /** Box coverage — a product sold by the box is sold by area. */
  sqmPerBox?: number | string | null;
};

/** A spec value by key, matching the key case-insensitively (as pickSpec does). */
function specValue(
  specs: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  if (!specs) return undefined;
  const direct = specs[key];
  if (direct != null && String(direct).trim()) return direct;
  const hit = Object.entries(specs).find(
    ([k]) => k.toLowerCase() === key.toLowerCase(),
  );
  return hit?.[1] != null && String(hit[1]).trim() ? hit[1] : undefined;
}

/**
 * The rule's input from a stored product and its brand — what the server
 * re-checks against. Mirrors how the product page fills the same fields.
 */
export function freeSampleInputFromProduct(
  product: {
    price?: unknown;
    department?: unknown;
    category?: unknown;
    subCategory?: unknown;
    specs?: unknown;
    soldPerUnit?: unknown;
    pergolaSizeRows?: unknown;
  },
  brand?: { name?: string | null; slug?: string | null } | null,
): FreeSampleInput {
  const specs =
    product.specs && typeof product.specs === "object"
      ? (product.specs as Record<string, unknown>)
      : null;
  const priceMode = specValue(specs, "priceDisplay");
  const sqmPerBox =
    specValue(specs, "sqmPerBox") ??
    specValue(specs, "Pack Coverage") ??
    specValue(specs, "packCoverage");
  return {
    price: Number(product.price),
    brandName: brand?.name ?? null,
    brandSlug: brand?.slug ?? null,
    priceMode: priceMode == null ? null : String(priceMode),
    department: product.department == null ? null : String(product.department),
    category: product.category == null ? null : String(product.category),
    subCategory:
      product.subCategory == null ? null : String(product.subCategory),
    specs,
    soldPerUnit:
      product.soldPerUnit === true ||
      (Array.isArray(product.pergolaSizeRows) &&
        product.pergolaSizeRows.length > 0),
    sqmPerBox: sqmPerBox == null ? null : String(sqmPerBox),
  };
}

const isBrand = (input: FreeSampleInput, slug: string, name: RegExp) =>
  String(input.brandSlug || "").toLowerCase() === slug ||
  name.test(String(input.brandName || ""));

export function hasFreeSample(input: FreeSampleInput): boolean {
  if (
    isPriceOnRequest(
      input.price,
      input.brandName,
      input.brandSlug,
      input.priceMode,
    )
  ) {
    return false;
  }

  // Charged-for samples (Otto Tiles) are not free ones.
  if (input.hasPaidSample || hasPaidSampleFlow(input.specs)) return false;
  if (isBrand(input, "otto-tiles", /^otto\s*tiles/i)) return false;

  // Heating sells by the kit, even where it sits beside tiles.
  if (isBrand(input, "the-under-floor-heating", /under.?floor.?heating/i)) {
    return false;
  }

  const department = String(input.department || "").toLowerCase();
  const category = String(input.category || "").toLowerCase();
  if (NOT_AREA_DEPARTMENTS.has(department)) return false;
  if (department === "tiles" && TILE_ACCESSORY_CATEGORIES.includes(category)) {
    return false;
  }
  if (
    isSpectraAdhesiveGroutCategory({
      brandSlug: input.brandSlug,
      category: input.category,
      categoryName: input.categoryName,
    })
  ) {
    return false;
  }
  if (input.soldPerUnit) return false;
  if (
    !AREA_DEPARTMENTS.has(department) &&
    NOT_A_SURFACE.test(`${input.category || ""} ${input.subCategory || ""}`)
  ) {
    return false;
  }

  // Any box coverage at all marks it as sold by area, as on the product page.
  const soldByTheBox = String(input.sqmPerBox ?? "").trim() !== "";
  return (
    AREA_DEPARTMENTS.has(department) ||
    soldByTheBox ||
    isAreaSoldCategory({
      department: input.department,
      category: input.category,
      subCategory: input.subCategory,
    })
  );
}

/* ------------------------------------------------------------------------ *
 * The basket
 *
 * A product with a free sample gets one sample line under it in the cart, at
 * £0, that the shopper cannot remove or change — it comes and goes with the
 * product. Nothing is stored for it: which products qualify is asked of the
 * server (getFreeSampleProductIds), and checkout adds the same £0 lines
 * from the same rule, so the basket and the order always agree.
 * ------------------------------------------------------------------------ */

/** "Free sample — Costa Green": the sample line's title, everywhere. */
export function freeSampleTitle(productName: string): string {
  return `Free sample — ${String(productName || "").trim() || "product"}`;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * The product a cart line is for, or null when it is not a catalogue product
 * (a made-to-measure configurator pick). Cart-line keys carry the chosen
 * option ("<productId>::CHROME-900"), so `productId` wins, then the key.
 */
export function cartLineProductId(line: {
  id: string;
  productId?: string | null;
}): string | null {
  const key = String(line.id || "");
  if (key.startsWith("cfg:")) return null;
  const id = String(line.productId || key.split("::")[0] || "");
  return OBJECT_ID.test(id) ? id : null;
}

/**
 * Which cart lines carry a sample row under them: the first line of each
 * product that has a free sample — one sample per product, however many
 * lines or boxes of it are in the basket.
 */
export function freeSampleRowLineIds(
  lines: { id: string; productId?: string | null }[],
  productIdsWithSample: ReadonlySet<string>,
): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const line of lines) {
    const productId = cartLineProductId(line);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    if (productIdsWithSample.has(productId)) out.add(line.id);
  }
  return out;
}

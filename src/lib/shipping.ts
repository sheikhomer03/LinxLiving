/**
 * Delivery rates.
 *
 * Single source of truth — the checkout summary, the review step and the order
 * record all read from here so the figure the customer sees is the figure they
 * are charged and the figure stored against the order.
 *
 * The charge is category-based: a basket containing any Tiles or Flooring
 * item is charged one flat rate, everything else another — never multiplied
 * by quantity, never summed across categories. This reads the `category`
 * field every cart item already carries, so it needs no new data on the
 * product or cart models.
 */

export const STANDARD_DELIVERY = {
  method: "Standard Delivery",
  /** Working days */
  leadTimeDays: 20,
  blurb: "Up to 20 business days • Fully tracked",
} as const;

/** Flat per-order charge when the basket contains any Tiles or Flooring item. */
export const TILE_FLOORING_DELIVERY = 60;

/** Flat per-order charge for every other basket. */
export const STANDARD_ITEM_DELIVERY = 100;

/** Orders at or above this goods total ship free. */
export const FREE_DELIVERY_THRESHOLD = 300;

/**
 * Category slugs that are actual Tiles or Flooring material — porcelain/LVT/
 * laminate/wood packs, the heavy palletised goods this rate is about. This
 * deliberately excludes categories that sit under a "flooring" department
 * for some brands but aren't flooring material itself (mats, rugs, carpet,
 * bathroom fixtures, artificial grass) — those ship as a light parcel, not a
 * pallet, so they take the standard rate.
 */
const TILE_FLOORING_CATEGORIES = new Set([
  // Tiles
  "floor-and-wall",
  "signature-collection",
  "terrazzo",
  "encaustic-cement",
  "zellige-and-bejmat",
  "ceramic",
  "ceramic-tiles",
  "gloss",
  "high-gloss",
  "matt",
  "matt-carving",
  "600x600-tiles",
  "outdoor-tiles",
  "zellige",
  "marble",
  "cement",
  "patterned",
  "plain",
  "mosaics-and-decorations",
  "terrena",
  "tiles",
  // LVT / vinyl
  "lvt",
  "lvt-flooring",
  "luxury-vinyl-tile",
  "vinyl",
  "conservatory-lvt-flooring",
  // Laminate
  "laminate",
  "laminate-flooring",
  "8mm-laminate-flooring",
  "10mm-laminate-flooring",
  "12mm-laminate-flooring",
  // Wood
  "wood",
  "wood-floors",
  "wood-flooring",
  "engineered-wood-flooring",
  "solid-wood-flooring",
  "herringbone-wood-flooring",
  "chevron-parquet-flooring",
  "parquet-flooring",
  "the-family-floor-engineered-hardwood-flooring",
  "trade-flooring",
  "14mm-wood-flooring",
  "20mm-wood-flooring",
  // Misc flooring collections
  "mb-flooring",
  "cotswold",
  "inspired-living-collection",
  "simply-stunning-collection",
  "coretec-collection",
  "palio-karndean-collection",
]);

/** True when any line in the basket is Tiles or Flooring material. */
function hasTileOrFlooringItem(
  items?: Array<{ category?: string | null }> | null,
): boolean {
  if (!items?.length) return false;
  return items.some(
    (item) => item.category && TILE_FLOORING_CATEGORIES.has(item.category),
  );
}

/**
 * Delivery cost for a basket.
 *
 * `subtotal` is the goods total including VAT — the figure the customer sees
 * in the basket, so the threshold means what they expect it to mean. `items`
 * only needs a `category` per line; an unrecognised category is treated as
 * "not tiles/flooring" rather than erroring. Both params are optional:
 * callers with no basket (an empty cart summary, a static rate table) still
 * get the standard rate rather than a free one.
 */
export function shippingCostFor(
  items?: Array<{ category?: string | null }> | null,
  subtotal?: number | null,
): number {
  const goods = Number(subtotal);
  if (Number.isFinite(goods) && goods >= FREE_DELIVERY_THRESHOLD) return 0;
  return hasTileOrFlooringItem(items)
    ? TILE_FLOORING_DELIVERY
    : STANDARD_ITEM_DELIVERY;
}

/** True when this basket qualifies for free delivery. */
export function qualifiesForFreeDelivery(subtotal?: number | null): boolean {
  const goods = Number(subtotal);
  return Number.isFinite(goods) && goods >= FREE_DELIVERY_THRESHOLD;
}

/** How much more is needed to reach free delivery, or 0 if already there. */
export function amountToFreeDelivery(subtotal?: number | null): number {
  const goods = Number(subtotal) || 0;
  return Math.max(0, FREE_DELIVERY_THRESHOLD - goods);
}

/** "20 business days" — used in checkout copy and order emails. */
export function deliveryEstimateLabel() {
  return `${STANDARD_DELIVERY.leadTimeDays} business days`;
}

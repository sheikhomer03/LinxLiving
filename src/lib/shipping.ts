/**
 * Delivery rates.
 *
 * Single source of truth — the checkout summary, the review step and the order
 * record all read from here so the figure the customer sees is the figure they
 * are charged and the figure stored against the order.
 */

export const STANDARD_DELIVERY = {
  method: "Standard Delivery",
  cost: 50,
  /** Working days */
  leadTimeDays: 20,
  blurb: "Up to 20 business days • Fully tracked",
} as const;

/** Orders at or above this goods total ship free. */
export const FREE_DELIVERY_THRESHOLD = 300;

/**
 * Delivery cost for a method and basket value.
 *
 * `subtotal` is the goods total including VAT — the figure the customer sees
 * in the basket, so the threshold means what they expect it to mean. It is
 * optional: callers that genuinely have no basket (an empty cart summary, a
 * static rate table) still get the standard rate rather than a free one.
 */
export function shippingCostFor(
  _method?: string | null,
  subtotal?: number | null,
): number {
  const goods = Number(subtotal);
  if (Number.isFinite(goods) && goods >= FREE_DELIVERY_THRESHOLD) return 0;
  return STANDARD_DELIVERY.cost;
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

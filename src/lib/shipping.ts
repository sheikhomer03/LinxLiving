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

/** Delivery cost for a given method name. */
export function shippingCostFor(_method?: string | null): number {
  return STANDARD_DELIVERY.cost;
}

/** "20 business days" — used in checkout copy and order emails. */
export function deliveryEstimateLabel() {
  return `${STANDARD_DELIVERY.leadTimeDays} business days`;
}

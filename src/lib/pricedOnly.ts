/**
 * Storefront visibility rule: only products with a price are listed.
 *
 * Products without a price were previously shown with a "TBC" label and a
 * "Request a quote" button. With this on they are hidden from listings,
 * search, the mega menus and facet counts entirely.
 *
 * Nothing is deleted — the products stay in the database and remain fully
 * visible and editable in the admin area. Give a product a price and it
 * reappears on the storefront by itself.
 *
 * Set to false to show unpriced products again.
 */
export const SHOW_ONLY_PRICED_PRODUCTS = true;

/** Mongo clause to append when unpriced products should stay hidden. */
export function pricedOnlyClause(): Record<string, unknown> | null {
  return SHOW_ONLY_PRICED_PRODUCTS ? { price: { $gt: 0 } } : null;
}

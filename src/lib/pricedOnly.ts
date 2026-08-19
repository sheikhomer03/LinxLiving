/**
 * Storefront visibility rules: what the catalogue is allowed to list.
 *
 * Two rules, each with its own switch:
 *
 * - A product without a price was previously shown with a "TBC" label and a
 *   "Request a quote" button. With that rule on it is hidden from listings,
 *   search, the mega menus and facet counts entirely.
 * - A product without an image renders an empty grey card, which reads as a
 *   broken listing rather than a product awaiting a photograph. Supplier
 *   catalogues routinely price more codes than they photograph — RAK ship 437
 *   of 2,083 with no picture anywhere — so this is a standing condition, not a
 *   one-off cleanup.
 *
 * Nothing is deleted. The products stay in the database and remain fully
 * visible and editable in the admin area; give a product a price or an image
 * and it reappears on the storefront by itself.
 *
 * Set either constant to false to show those products again.
 */
export const SHOW_ONLY_PRICED_PRODUCTS = true;
export const SHOW_ONLY_PRODUCTS_WITH_IMAGES = true;

/** Mongo clause to append when unpriced products should stay hidden. */
export function pricedOnlyClause(): Record<string, unknown> | null {
  return SHOW_ONLY_PRICED_PRODUCTS ? { price: { $gt: 0 } } : null;
}

/**
 * Mongo clause to append when imageless products should stay hidden.
 *
 * `images.0` existing is not sufficient on its own: a few hundred products
 * imported from likewisefloors carry a "no photo available" placeholder .svg
 * in the first slot, which is a non-empty entry and would pass. No genuine
 * product photograph in this catalogue is an SVG, so the extension is a
 * reliable way to exclude those too — the same pair of tests the listing
 * query's own `requireImages` option already applies.
 *
 * The placeholder test is a literal RegExp rather than `{ $regex, $options }`:
 * Mongo rejects the operator form inside `$not` outright (Location51091), so
 * the object form would throw on every query rather than merely mismatch.
 */
export function hasImageClause(): Record<string, unknown> | null {
  if (!SHOW_ONLY_PRODUCTS_WITH_IMAGES) return null;
  return {
    "images.0": {
      $exists: true,
      $nin: [null, ""],
      $not: /\.svg($|\?)/i,
    },
  };
}

/**
 * Every storefront visibility rule as one clause, ready to spread into a
 * filter or push onto an `$and`.
 *
 * Call sites take the rules as a set rather than naming them one by one, so a
 * rule added here reaches the listings, search, mega menus, facet counts and
 * homepage bands together instead of being applied to some and missed on
 * others.
 */
export function storefrontVisibilityClause(): Record<string, unknown> {
  return {
    ...(pricedOnlyClause() || {}),
    ...(hasImageClause() || {}),
  };
}

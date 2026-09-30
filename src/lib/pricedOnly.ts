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
 * A product counts as photographed if it has EITHER a local gallery or a
 * Shopify one. Testing `images` alone was right only while Cloudinary was the
 * host: once the galleries were mirrored to Shopify and the `images` arrays
 * dropped to reclaim cluster space, that test hid 20,308 priced, photographed
 * products — the whole catalogue bar a few hundred — even though the
 * storefront renders them perfectly from `shopifyImages` via
 * `resolveGalleryImages`.
 *
 * `images.0` existing is not sufficient on its own: a few hundred products
 * imported from likewisefloors carry a "no photo available" placeholder .svg
 * in the first slot, which is a non-empty entry and would pass. No genuine
 * product photograph in this catalogue is an SVG, so the extension is a
 * reliable way to exclude those too.
 *
 * The placeholder test is a literal RegExp rather than `{ $regex, $options }`:
 * Mongo rejects the operator form inside `$not` outright (Location51091), so
 * the object form would throw on every query rather than merely mismatch.
 *
 * The same placeholders were mirrored to Shopify, so the Shopify gallery is
 * tested the same way — and so is Al Murad's `no_image.jpg`, a supplier "no
 * photo" graphic that is not an SVG. Before this, a product whose only
 * picture was one of those passed on `shopifyImages` and listed with a grey
 * "No Image" card.
 *
 * NOTE: this returns a top-level `$or`. Spreading it into a filter that also
 * sets `$or` silently drops one of them — put the caller's own condition
 * under `$and` instead.
 */
export function hasImageClause(): Record<string, unknown> | null {
  if (!SHOW_ONLY_PRODUCTS_WITH_IMAGES) return null;
  return {
    $or: [
      {
        "images.0": {
          $exists: true,
          $nin: [null, ""],
          $not: PLACEHOLDER_IMAGE,
        },
      },
      {
        "shopifyImages.0": { $exists: true },
        "shopifyImages.0.shopifyUrl": { $not: PLACEHOLDER_IMAGE },
      },
    ],
  };
}

/**
 * A supplier's "no photo" graphic rather than a photograph: any SVG, or a
 * file named no_image / no-image / noimage.
 */
const PLACEHOLDER_IMAGE = /\.svg($|\?)|\/no[-_]?image[^/]*$/i;

/**
 * True when a product's pictures are only a placeholder — the case
 * `hasImageClause` hides from listings. The product page uses it so the same
 * products are not reachable by a direct link either. A product with no
 * pictures at all is left as it was.
 */
export function hasOnlyPlaceholderImage(product: {
  images?: unknown[];
  shopifyImages?: { shopifyUrl?: string }[];
}): boolean {
  if (!SHOW_ONLY_PRODUCTS_WITH_IMAGES) return false;
  const local = String(product.images?.[0] ?? "");
  const mirrored = product.shopifyImages?.[0];
  if (!local && !mirrored) return false;
  const localOk = Boolean(local) && !PLACEHOLDER_IMAGE.test(local);
  const mirroredOk =
    Boolean(mirrored) && !PLACEHOLDER_IMAGE.test(String(mirrored?.shopifyUrl ?? ""));
  return !localOk && !mirroredOk;
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

import { revalidatePath, revalidateTag } from "next/cache";

/**
 * What to clear when a product is created, changed or deleted.
 *
 * This used to be `revalidatePath("/", "layout")`, which expires every page
 * AND every `unstable_cache` entry on the site — they carry the route as an
 * implicit tag. Menus, department trees, brand trees and facet counts were
 * thrown away with it, and the next shopper waited while they were rebuilt
 * (the navigation alone took 12 s cold). It ran on every Shopify
 * `products/update` webhook, including the echo of each save made here.
 *
 * Only what shows product data is cleared now, and cleared at once exactly
 * as before: listings (every cache tagged `catalogue-listing` — department
 * grids, home strips, related products, search suggestions), the product
 * pages (`products`), and the home page. Menus and facet counts, which are
 * navigation rather than product data, keep refreshing on their own
 * timers. Admin edits to menus and departments clear them explicitly, as
 * they always have.
 */
export function revalidateProductCaches(productId?: string | null) {
  revalidateTag("catalogue-listing", { expire: 0 });
  revalidateTag("products", { expire: 0 });
  revalidatePath("/");
  // Every product page, not just this one: another product's page can show
  // this product as an add-on, swatch or related item. This is what the
  // `products` tag did when product pages read the product through it.
  revalidatePath("/products/[id]", "page");
  if (productId) revalidatePath(`/products/${productId}`);
}

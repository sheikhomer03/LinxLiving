import { revalidatePath, revalidateTag } from "next/cache";
import { productHref } from "@/lib/productSlug";

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
export function revalidateProductCaches(
  productId?: string | null,
  /** The product's slug, when the caller has it — its page lives at that URL. */
  slug?: string | null,
) {
  revalidateTag("catalogue-listing", { expire: 0 });
  revalidatePath("/");
  /*
   * The one product that changed, not all 22,000 of them.
   *
   * `revalidateTag("products")` and `revalidatePath("/products/[slug]",
   * "page")` both expired every product page on the site. The Shopify pull
   * upserts up to ten products every ninety seconds while an admin tab is
   * open, so the whole catalogue was marked stale around a thousand times a
   * day, and each page that anything then visited — a shopper, a crawler,
   * the sitemap — was rendered and written to the ISR cache again. Those
   * writes are metered, and they were the largest line on the Vercel bill.
   *
   * The reason given for the blanket clear was that another product's page
   * can show this one as an add-on, swatch or related item. Those pages
   * still pick the change up on their own revalidate window, which is what
   * every other derived view here does.
   */
  if (productId) {
    revalidateTag(`product:${productId}`, { expire: 0 });
    revalidatePath(productHref({ id: productId }));
  }
  if (slug) {
    revalidateTag(`product:${slug}`, { expire: 0 });
    revalidatePath(productHref({ slug }));
  }
}

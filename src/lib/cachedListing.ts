import { unstable_cache } from "next/cache";
import { getPublicProducts } from "@/app/actions/products";

/**
 * How long a department's first page is reused before it is queried again.
 *
 * Short on purpose. It exists so that walking the navbar — Flooring, back,
 * Tiles, back, Flooring — pays for each department once rather than once per
 * click, which is the difference between a page that opens and a page that
 * loads. It is not a substitute for the query being fast.
 *
 * A minute is in keeping with what the storefront already tolerates: the
 * navigation trees cache for five, and StorefrontLiveRefresh coalesces admin
 * catalogue changes into a refresh every twelve seconds at most.
 */
const LISTING_TTL_SECONDS = 60;

/**
 * The first page of a listing, as the navbar asks for it.
 *
 * Only the server-rendered landing is cached. Anything the shopper does on the
 * page — a filter, a sort, a second page — goes through the action directly
 * and reads live price and stock, so the cached copy is only ever the view
 * they arrive at, never one they have changed.
 */
export const getCachedListingProducts = unstable_cache(
  async (queryJson: string) =>
    getPublicProducts(JSON.parse(queryJson) as Parameters<typeof getPublicProducts>[0]),
  ["catalogue-listing-v1"],
  { revalidate: LISTING_TTL_SECONDS, tags: ["catalogue-listing"] },
);

/** Cache key and payload are the same object — stringified once, here. */
export function getListingFirstPage(
  query: Parameters<typeof getPublicProducts>[0],
) {
  return getCachedListingProducts(JSON.stringify(query));
}

import { unstable_cache } from "@/lib/sharedCache";
import { getPublicProducts } from "@/app/actions/products";
import {
  isFailedListing,
  ListingUnavailableError,
} from "@/lib/listingFailure";

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
/*
 * 30, with the CDN holding the catalogue pages for up to another 30 (see
 * next.config.ts): together no more than the 60 this was before those pages
 * were cached.
 */
const LISTING_TTL_SECONDS = 30;

/**
 * The first page of a listing, as the navbar asks for it.
 *
 * Only the server-rendered landing is cached. Anything the shopper does on the
 * page — a filter, a sort, a second page — goes through the action directly
 * and reads live price and stock, so the cached copy is only ever the view
 * they arrive at, never one they have changed.
 */
export const getCachedListingProducts = unstable_cache(
  async (queryJson: string) => {
    const result = await getPublicProducts(
      JSON.parse(queryJson) as Parameters<typeof getPublicProducts>[0],
    );
    /*
     * The layer below already declines to cache a failed read; this one has to
     * decline as well, or the failure is simply stored here instead. A query
     * that timed out would otherwise answer "No products found" for every
     * visitor for the whole TTL, which is what made departments empty at
     * random rather than consistently.
     */
    if (isFailedListing(result)) throw new ListingUnavailableError();
    return result;
  },
  ["catalogue-listing-v1"],
  { revalidate: LISTING_TTL_SECONDS, tags: ["catalogue-listing"] },
);

/** Cache key and payload are the same object — stringified once, here. */
export function getListingFirstPage(
  query: Parameters<typeof getPublicProducts>[0],
) {
  return getCachedListingProducts(JSON.stringify(query)).catch(
    (error: unknown) => {
      if (!(error instanceof ListingUnavailableError)) throw error;
      // Empty for this request only, and nothing cached, so the next render
      // queries again instead of inheriting the failure.
      return { products: [], total: 0, page: 1, limit: 12, totalPages: 0 };
    },
  );
}

/**
 * Telling a failed listing apart from an empty one.
 *
 * `_getPublicProductsLive` catches its own errors and answers with an empty
 * result, which is the right thing for a page to render but the wrong thing
 * for a cache to keep: two layers of `unstable_cache` sit above it, so one
 * timed-out query became "No products found" for every visitor until the
 * entry expired. Departments therefore emptied at random rather than
 * consistently, and recovered on their own, which is what made it hard to see.
 *
 * These live outside `actions/products.ts` because that file is "use server",
 * where only async functions may be exported.
 */

/**
 * A symbol, so it cannot collide with a product field and does not survive
 * `JSON.stringify` — it only has to travel from the query to the wrappers
 * directly above it.
 */
export const LISTING_FAILED = Symbol.for("linx.listing.failed");

/** Thrown inside a cached read so that nothing is stored for it. */
export class ListingUnavailableError extends Error {
  constructor() {
    super("listing unavailable");
    this.name = "ListingUnavailableError";
  }
}

export function isFailedListing(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<symbol, unknown>)[LISTING_FAILED],
  );
}

export const EMPTY_LISTING = {
  products: [] as never[],
  total: 0,
  page: 1,
  limit: 12,
  totalPages: 0,
};

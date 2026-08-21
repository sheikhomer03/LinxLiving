/**
 * Shared review rules.
 *
 * Separate from `@/app/actions/reviews` because that file is `"use server"`,
 * where only async functions may be exported — a plain `export const` there is
 * a build error, not a type error, so it compiles clean and fails at runtime.
 * The review form also needs these values on the client.
 */

export const MAX_REVIEW_PHOTOS = 5;

/** Largest file the upload route accepts, before Cloudinary resizes it. */
export const MAX_REVIEW_PHOTO_BYTES = 8 * 1024 * 1024;

export const ALLOWED_REVIEW_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

/** Cloudinary folder customer photos are uploaded to. */
export const REVIEW_PHOTO_FOLDER = "linx-living/reviews";

/**
 * Review photos must be Cloudinary URLs inside our own review folder.
 *
 * The list is posted from the browser, so without this a review could embed
 * an arbitrary remote image on a product page.
 */
export const REVIEW_PHOTO_RX =
  /^https:\/\/res\.cloudinary\.com\/[\w-]+\/image\/upload\/[\w\-/.,:%]*linx-living\/reviews\//;

/**
 * Order states that entitle a customer to review.
 *
 * The product has to have actually reached them — reviewing something still
 * "Processing" is a review of the checkout, not the product. Returned,
 * refunded and cancelled orders are excluded: the customer no longer has the
 * item, and a refunded order should not carry a verified badge.
 */
export const REVIEWABLE_ORDER_STATUSES = [
  "Dispatched",
  "Shipped",
  "Out for Delivery",
  "Delivered",
];

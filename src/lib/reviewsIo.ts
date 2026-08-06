/**
 * Reviews.io company reviews.
 *
 * Pulled live from the public merchant API rather than copied into the repo,
 * so the rating and count stay correct as new reviews come in. The public
 * company page itself returns 403 to servers, so the API is the supported
 * route.
 *
 * Store is the reviews.io account, which currently trades under the LINX
 * Glass domain while reporting the store name "LINX Square".
 */

export const REVIEWS_IO_STORE = "www.linxglass.co.uk";
export const REVIEWS_IO_URL =
  "https://www.reviews.io/company-reviews/store/www.linxglass.co.uk";

export type CompanyReview = {
  id: string;
  rating: number;
  comments: string;
  date: string;
  reviewer: string;
};

export type CompanyReviewSummary = {
  average: number;
  total: number;
  /** reviews.io's own word for the score, e.g. "Excellent". */
  word: string;
  reviews: CompanyReview[];
};

const EMPTY: CompanyReviewSummary = {
  average: 0,
  total: 0,
  word: "",
  reviews: [],
};

/**
 * Fetch the latest reviews. Cached for an hour — this is marketing content on
 * every page, not something that needs to be live to the second, and it keeps
 * us well clear of rate limits.
 */
export async function getCompanyReviews(
  limit = 12,
): Promise<CompanyReviewSummary> {
  try {
    const res = await fetch(
      `https://api.reviews.io/merchant/reviews?store=${encodeURIComponent(
        REVIEWS_IO_STORE,
      )}&per_page=${Math.max(1, Math.min(limit, 50))}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return EMPTY;

    const data = await res.json();
    const stats = data?.stats || {};
    const rows: any[] = Array.isArray(data?.reviews) ? data.reviews : [];

    return {
      average: Number(stats.average_rating) || 0,
      total: Number(stats.total_reviews) || 0,
      word: String(data?.word || ""),
      reviews: rows
        .filter((r) => String(r?.comments || "").trim())
        .slice(0, limit)
        .map((r) => ({
          id: String(r.store_review_id ?? r.id ?? Math.random()),
          rating: Number(r.rating) || 0,
          comments: String(r.comments || "").trim(),
          date: String(r.date_created || "").slice(0, 10),
          reviewer:
            String(r?.reviewer?.first_name || "").trim() || "Verified customer",
        })),
    };
  } catch (error) {
    console.error("getCompanyReviews:", error);
    return EMPTY;
  }
}

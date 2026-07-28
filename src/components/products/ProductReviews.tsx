"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Star, CheckCircle2, Loader2 } from "lucide-react";
import { submitProductReview } from "@/app/actions/reviews";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type ProductReviewItem = {
  _id: string;
  name: string;
  rating: number;
  title?: string;
  comment: string;
  createdAt: string;
};

interface ProductReviewsPanelProps {
  productId: string;
  reviews: ProductReviewItem[];
  averageRating: number;
  reviewCount: number;
}

function formatReviewDate(value: string) {
  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

const STAR_GOLD = "#C4A35A";

export function ProductReviewsPanel({
  productId,
  reviews,
  averageRating,
  reviewCount,
}: ProductReviewsPanelProps) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const isAuthenticated = status === "authenticated" && Boolean(session?.user);
  const loginHref = `/login?callbackUrl=${encodeURIComponent(pathname || "/")}`;

  useEffect(() => {
    setSubmitted(false);
  }, [productId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) return;

    startTransition(async () => {
      const result = await submitProductReview({
        productId,
        name: session?.user?.name || "Customer",
        email: session?.user?.email || "",
        rating,
        comment,
      });
      if (result.success) {
        toast.success(result.message || "Review submitted");
        setSubmitted(true);
        setComment("");
        setRating(5);
      } else {
        toast.error(result.error || "Could not submit review");
      }
    });
  };

  const activeStars = hoverRating || rating;

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-3">
        <h2 className="font-serif text-3xl md:text-[2.15rem] tracking-tight text-foreground leading-none">
          Customer Reviews
        </h2>
        {reviewCount === 0 ? (
          <p className="text-[15px] text-foreground/55">
            No reviews yet — be the first to share your experience.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm text-foreground/65">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className="w-4 h-4"
                  style={{
                    color: STAR_GOLD,
                    fill: n <= Math.round(averageRating) ? STAR_GOLD : "transparent",
                  }}
                />
              ))}
            </div>
            <span>
              {averageRating.toFixed(1)} average · {reviewCount} review
              {reviewCount === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-[#f5f5f5] border border-black/5 px-6 py-7 md:px-8 md:py-8">
        <h3 className="font-serif text-[15px] md:text-base uppercase tracking-[0.06em] font-semibold text-foreground mb-2">
          Write a Review
        </h3>

        {status === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-foreground/50 py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking account…
          </div>
        ) : !isAuthenticated ? (
          <p className="text-sm text-foreground/60 leading-relaxed">
            Please{" "}
            <Link
              href={loginHref}
              className="underline underline-offset-2 font-medium text-foreground hover:opacity-70 transition-opacity"
            >
              sign in
            </Link>{" "}
            to rate and review this product.
          </p>
        ) : submitted ? (
          <p className="text-sm text-foreground/60 leading-relaxed pt-1">
            Thanks — your review was submitted and will appear here once an
            admin approves it.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-[13px] text-foreground/50 leading-relaxed">
              Reviews are submitted for admin approval and cannot be edited
              after posting.
            </p>

            <div className="space-y-2">
              <p className="text-[13px] text-foreground/70">Your rating</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(n)}
                    className="p-0.5"
                    aria-label={`${n} stars`}
                  >
                    <Star
                      className="w-7 h-7 transition-opacity"
                      style={{
                        color: STAR_GOLD,
                        fill: n <= activeStars ? STAR_GOLD : "transparent",
                        opacity: n <= activeStars ? 1 : 0.35,
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="product-review-comment"
                className="block text-[13px] text-foreground/70"
              >
                Your review
              </label>
              <textarea
                id="product-review-comment"
                required
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share details about quality, fit, delivery, or installation..."
                rows={5}
                maxLength={2000}
                className="w-full rounded-lg border border-black/10 bg-white px-4 py-3.5 text-[15px] text-foreground outline-none placeholder:text-foreground/35 focus:border-black/25 resize-y min-h-[120px]"
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-black text-white px-8 py-3 text-[14px] font-medium hover:bg-black/85 transition-colors disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                "Submit review"
              )}
            </button>
          </form>
        )}
      </div>

      {reviews.length > 0 ? (
        <div className="space-y-4 pt-2">
          {reviews.map((review) => (
            <article
              key={review._id}
              className="rounded-xl border border-black/8 bg-white p-6 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold tracking-wide">
                    {review.name}
                  </p>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-foreground/50">
                      Verified
                    </span>
                  </div>
                </div>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className="w-3.5 h-3.5"
                      style={{
                        color: STAR_GOLD,
                        fill: n <= review.rating ? STAR_GOLD : "transparent",
                      }}
                    />
                  ))}
                </div>
              </div>
              <p className="text-[15px] leading-relaxed text-foreground/75">
                {review.comment}
              </p>
              <p className="text-[12px] text-foreground/40">
                {formatReviewDate(review.createdAt)}
              </p>
            </article>
          ))}
        </div>
      ) : isAuthenticated && !submitted ? null : (
        <p className="text-sm text-foreground/45">
          Reviews will appear here once customers submit them.
        </p>
      )}
    </div>
  );
}

/** @deprecated Use ProductReviewsPanel inside ProductDetailTabs */
export function ProductReviews() {
  return null;
}

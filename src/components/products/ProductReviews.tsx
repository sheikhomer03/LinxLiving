"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Star, CheckCircle2, Loader2, ImagePlus, X, BadgeCheck } from "lucide-react";
import Image from "next/image";
import {
  submitProductReview,
  getReviewEligibility,
} from "@/app/actions/reviews";
import { MAX_REVIEW_PHOTOS } from "@/lib/reviewRules";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type ProductReviewItem = {
  _id: string;
  name: string;
  rating: number;
  title?: string;
  comment: string;
  createdAt: string;
  photos?: string[];
  verifiedPurchase?: boolean;
};

type Eligibility = {
  canReview: boolean;
  reason: "ok" | "signed-out" | "not-purchased" | "already-reviewed" | "invalid" | "error";
  status?: string;
  orderNumber?: string;
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
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);

  const isAuthenticated = status === "authenticated" && Boolean(session?.user);
  const loginHref = `/login?callbackUrl=${encodeURIComponent(pathname || "/")}`;

  useEffect(() => {
    setSubmitted(false);
    setPhotos([]);
  }, [productId]);

  // Ask the server whether this customer bought the product, so the panel can
  // explain itself instead of failing on submit.
  useEffect(() => {
    let active = true;
    if (status !== "authenticated") {
      setEligibility(null);
      return;
    }
    getReviewEligibility(productId).then((result) => {
      if (active) setEligibility(result as Eligibility);
    });
    return () => {
      active = false;
    };
  }, [productId, status, submitted]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_REVIEW_PHOTOS - photos.length;
    if (room <= 0) {
      toast.error(`You can add up to ${MAX_REVIEW_PHOTOS} photos`);
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const body = new FormData();
        body.append("file", file);
        body.append("productId", productId);
        const res = await fetch("/api/reviews/upload", { method: "POST", body });
        const data = await res.json();
        if (data.url) {
          setPhotos((current) => [...current, data.url]);
        } else {
          toast.error(data.error || "Could not upload that photo");
        }
      }
    } catch {
      toast.error("Could not upload photos");
    } finally {
      setUploading(false);
    }
  };

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
        photos,
      });
      if (result.success) {
        toast.success(result.message || "Review submitted");
        setSubmitted(true);
        setComment("");
        setRating(5);
        setPhotos([]);
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
        ) : !eligibility ? (
          <div className="flex items-center gap-2 text-sm text-foreground/50 py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking your orders…
          </div>
        ) : eligibility.reason === "already-reviewed" ? (
          <p className="text-sm text-foreground/60 leading-relaxed pt-1">
            You have already reviewed this product
            {eligibility.status === "pending"
              ? " — it will appear here once an admin approves it."
              : "."}
          </p>
        ) : !eligibility.canReview ? (
          <p className="text-sm text-foreground/60 leading-relaxed pt-1">
            Reviews come from customers who have bought this product. Once your
            order has been dispatched you will be able to rate it and add
            photos here.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
              <BadgeCheck className="h-4 w-4" />
              Verified purchase
              {eligibility.orderNumber ? ` · order ${eligibility.orderNumber}` : ""}
            </p>
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

            <div className="space-y-2">
              <p className="text-[13px] text-foreground/70">
                Add photos{" "}
                <span className="text-foreground/45">
                  (optional, up to {MAX_REVIEW_PHOTOS}) — show how it arrived
                </span>
              </p>

              <div className="flex flex-wrap gap-3">
                {photos.map((url) => (
                  <div
                    key={url}
                    className="relative h-20 w-20 overflow-hidden rounded-lg border border-black/10"
                  >
                    <Image
                      src={url}
                      alt="Your review photo"
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPhotos((c) => c.filter((p) => p !== url))
                      }
                      aria-label="Remove photo"
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-1 text-white hover:bg-black"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}

                {photos.length < MAX_REVIEW_PHOTOS ? (
                  <label
                    className={cn(
                      "flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-black/20 bg-white text-foreground/50 transition-colors hover:border-black/40",
                      uploading && "pointer-events-none opacity-60",
                    )}
                  >
                    {uploading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <ImagePlus className="h-5 w-5" />
                        <span className="text-[10px] uppercase tracking-wide">
                          Add
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        addPhotos(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
              </div>
            </div>

            <button
              type="submit"
              disabled={isPending || uploading}
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
                  {/* Only shown when the review is actually tied to an order —
                      it used to render on every review regardless. */}
                  {review.verifiedPurchase ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-foreground/50">
                        Verified purchase
                      </span>
                    </div>
                  ) : null}
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

              {review.photos?.length ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {review.photos.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative h-20 w-20 overflow-hidden rounded-lg border border-black/10 transition-opacity hover:opacity-85"
                    >
                      <Image
                        src={url}
                        alt={`Photo from ${review.name}'s review`}
                        fill
                        sizes="80px"
                        className="object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : null}

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

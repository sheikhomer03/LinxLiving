"use client";

import { StarRating } from "@/components/products/StarRating";
import { cn } from "@/lib/utils";

interface ProductRatingSummaryProps {
  averageRating: number;
  reviewCount: number;
  onClickReviews?: () => void;
  className?: string;
}

/**
 * Linx Glass ProductRatingSummary — empty stars + “Be the first to review”
 * when count is 0; filled stars + average when reviews exist.
 */
export function ProductRatingSummary({
  averageRating,
  reviewCount,
  onClickReviews,
  className,
}: ProductRatingSummaryProps) {
  const interactive = Boolean(onClickReviews);
  const Wrapper = interactive ? "button" : "div";

  if (reviewCount === 0) {
    if (!interactive) return null;

    return (
      <button
        type="button"
        onClick={onClickReviews}
        className={cn(
          "inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors",
          className,
        )}
      >
        <StarRating value={0} readOnly size="sm" />
        <span className="underline underline-offset-2">Be the first to review</span>
      </button>
    );
  }

  return (
    <Wrapper
      {...(interactive
        ? {
            type: "button" as const,
            onClick: onClickReviews,
          }
        : {})}
      className={cn(
        "inline-flex flex-wrap items-center gap-2",
        interactive && "hover:opacity-80 transition-opacity text-left",
        className,
      )}
    >
      <StarRating value={Math.round(averageRating)} readOnly size="sm" />
      <span className="text-sm font-semibold text-foreground">
        {averageRating.toFixed(1)}
      </span>
    </Wrapper>
  );
}

export const OPEN_PRODUCT_REVIEWS_EVENT = "product:open-reviews";

export function openProductReviewsTab() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PRODUCT_REVIEWS_EVENT));
}

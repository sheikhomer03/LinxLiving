"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  onChange?: (rating: number) => void;
  readOnly?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** Linx Glass–style star row (empty outline when value is 0). */
export function StarRating({
  value,
  onChange,
  readOnly = false,
  size = "md",
  className,
}: StarRatingProps) {
  const [hover, setHover] = useState(0);
  const iconClass = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {Array.from({ length: 5 }).map((_, index) => {
        const starValue = index + 1;
        const filled = starValue <= (hover || value);

        return readOnly ? (
          <span key={starValue} className="text-primary" aria-hidden>
            <Star
              className={cn(
                iconClass,
                filled
                  ? "fill-primary text-primary"
                  : "text-foreground/35",
              )}
            />
          </span>
        ) : (
          <button
            key={starValue}
            type="button"
            className="text-primary transition-colors cursor-pointer hover:scale-105"
            onClick={() => onChange?.(starValue)}
            onMouseEnter={() => setHover(starValue)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${starValue} star${starValue === 1 ? "" : "s"}`}
          >
            <Star
              className={cn(
                iconClass,
                filled
                  ? "fill-primary text-primary"
                  : "text-foreground/35",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

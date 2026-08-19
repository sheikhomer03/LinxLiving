"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Star, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSwipeNav } from "@/hooks/useSwipeNav";

/* ------------------------------------------------------------- offer slider */

export type OfferMessage = {
  text: string;
  href: string;
  /** Optional short call to action shown as a button. */
  cta?: string;
};

/**
 * Rotating offer bar.
 *
 * Dark red with white type so it separates hard from the cream and white
 * bands either side of it — this strip is meant to be the loudest thing on
 * the page.
 */
export function LuxeOfferSlider({
  offers,
  intervalMs = 5000,
}: {
  offers: OfferMessage[];
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);
  const paused = useRef(false);

  useEffect(() => {
    if (offers.length <= 1) return;
    const id = setInterval(() => {
      if (!paused.current) setIndex((i) => (i + 1) % offers.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [offers.length, intervalMs]);

  const { onTouchStart, onTouchEnd, consumeSwipeClick } = useSwipeNav(
    () => setIndex((i) => (i + 1) % offers.length),
    () => setIndex((i) => (i - 1 + offers.length) % offers.length),
  );

  if (!offers.length) return null;
  const offer = offers[index];

  return (
    <div
      className="bg-[#D3102F] text-white"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="max-w-350 mx-auto px-5 lg:px-10 h-13 flex items-center justify-center gap-4">
        <button
          type="button"
          aria-label="Previous offer"
          onClick={() =>
            setIndex((i) => (i - 1 + offers.length) % offers.length)
          }
          className={cn(
            "p-1 text-white/70 hover:text-white transition-colors",
            offers.length <= 1 && "invisible",
          )}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <Link
          href={offer.href}
          onClick={(e) => {
            if (consumeSwipeClick()) e.preventDefault();
          }}
          className="flex items-center gap-3 text-center group"
        >
          <Tag className="w-4 h-4 shrink-0 hidden sm:block" />
          <span className="text-[13px] md:text-[15px] font-bold tracking-wide">
            {offer.text}
          </span>
          {offer.cta ? (
            <span className="hidden sm:inline-block px-3 py-1 bg-white text-[#D3102F] text-[11px] uppercase tracking-[0.14em] font-bold group-hover:bg-white/90 transition-colors">
              {offer.cta}
            </span>
          ) : null}
        </Link>

        <button
          type="button"
          aria-label="Next offer"
          onClick={() => setIndex((i) => (i + 1) % offers.length)}
          className={cn(
            "p-1 text-white/70 hover:text-white transition-colors",
            offers.length <= 1 && "invisible",
          )}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- hero carousel */

/**
 * Full-bleed promo banners.
 *
 * A slide is either a `content` node — our own artwork, drawn in the browser —
 * or an `image` for anything supplied as a flat file.
 */
export type HeroSlide = {
  /** Our own vector/type artwork. Preferred; takes precedence over `image`. */
  content?: React.ReactNode;
  /** Desktop banner (~1920×550). Used only when `content` is absent. */
  image?: string;
  /** Optional square/mobile crop. */
  mobileImage?: string;
  href: string;
  alt: string;
  /** Kept for older callers / ordering — unused in VP layout. */
  eyebrow?: string;
  title?: string;
  body?: string;
  cta?: string;
  fromPrice?: number;
  perSqm?: boolean;
  productCount?: number;
  badgeWord?: string;
};

export function LuxeHeroCarousel({
  slides,
  intervalMs = 6500,
}: {
  slides: HeroSlide[];
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);
  const paused = useRef(false);

  const go = useCallback(
    (next: number) => setIndex((next + slides.length) % slides.length),
    [slides.length],
  );

  useEffect(() => {
    if (slides.length <= 1) return;
    const id = setInterval(() => {
      if (!paused.current) setIndex((i) => (i + 1) % slides.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [slides.length, intervalMs]);

  const { onTouchStart, onTouchEnd, consumeSwipeClick } = useSwipeNav(
    () => go(index + 1),
    () => go(index - 1),
  );

  if (!slides.length) return null;

  return (
    <section
      className="relative bg-[#f3f0eb]"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      aria-roledescription="carousel"
      aria-label="Promotions"
    >
      {/* Fixed height matches Victorian Plumbing banners (1920×550). */}
      <div
        className="relative w-full overflow-hidden h-80 sm:h-100 md:h-120 lg:h-137.5"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {slides.map((slide, i) => {
          const active = i === index;
          return (
            <div
              key={`${slide.alt}-${i}`}
              className={cn(
                "absolute inset-0 transition-opacity duration-500",
                active ? "opacity-100 z-1" : "opacity-0 z-0 pointer-events-none",
              )}
              aria-hidden={!active}
            >
              <Link
                href={slide.href}
                aria-label={slide.alt}
                onClick={(e) => {
                  if (consumeSwipeClick()) e.preventDefault();
                }}
                className="relative block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D3102F] focus-visible:ring-inset"
              >
                {slide.content ? (
                  slide.content
                ) : slide.image ? (
                  <>
                    <Image
                      src={slide.mobileImage || slide.image}
                      alt={slide.alt}
                      fill
                      priority={i === 0}
                      sizes="100vw"
                      className="object-cover object-center sm:hidden"
                    />
                    <Image
                      src={slide.image}
                      alt={slide.alt}
                      fill
                      priority={i === 0}
                      sizes="100vw"
                      className="object-cover object-center hidden sm:block"
                    />
                  </>
                ) : null}
              </Link>
            </div>
          );
        })}

        {slides.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous slide"
              onClick={() => go(index - 1)}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-12 sm:h-12 grid place-items-center bg-black/25 hover:bg-black/45 text-white transition-colors"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              onClick={() => go(index + 1)}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-12 sm:h-12 grid place-items-center bg-black/25 hover:bg-black/45 text-white transition-colors"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>

            <div className="absolute bottom-3 sm:bottom-4 left-0 right-0 z-10 flex items-center justify-center gap-2">
              {slides.map((s, i) => (
                <button
                  key={`dot-${s.alt}-${i}`}
                  type="button"
                  aria-label={`Go to slide ${i + 1}`}
                  aria-current={i === index}
                  onClick={() => go(i)}
                  className={cn(
                    "rounded-full transition-all shadow-sm",
                    i === index
                      ? "w-2.5 h-2.5 bg-white opacity-100"
                      : "w-2 h-2 bg-white opacity-40 hover:opacity-70",
                  )}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------- reviews carousel */

export type ReviewCarouselItem = {
  id: string;
  rating: number;
  comments: string;
  date: string;
  reviewer: string;
};

function ReviewStars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "w-4 h-4",
            i <= Math.round(rating)
              ? "fill-[#00b67a] text-[#00b67a]"
              : "fill-foreground/15 text-foreground/15",
          )}
        />
      ))}
    </span>
  );
}

function ReviewNavButton({
  direction,
  onClick,
  className,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  className?: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={direction === "prev" ? "Previous review" : "Next review"}
      onClick={onClick}
      className={cn(
        "w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-foreground bg-white grid place-items-center text-foreground hover:bg-foreground hover:text-white transition-colors shrink-0",
        className,
      )}
    >
      <Icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2.5} />
    </button>
  );
}

/**
 * Two reviews per view (one on mobile), arrows flanking the row left and
 * right on desktop; below that, no side gutter (the row runs edge-to-edge)
 * and the arrows move above the cards instead, since there's no longer
 * room to float them over the sides. Native scroll-snap drives the motion
 * (smooth, GPU-cheap) rather than a JS animation loop; same index +
 * setInterval + pause-on-hover idiom as the carousels above.
 */
export function LuxeReviewsCarousel({
  reviews,
  intervalMs = 6000,
}: {
  reviews: ReviewCarouselItem[];
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);
  const paused = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);

  const go = useCallback(
    (next: number) => setIndex((next + reviews.length) % reviews.length),
    [reviews.length],
  );

  useEffect(() => {
    // Scrolls only the track's own horizontal position — never
    // `scrollIntoView`, which (even with block: "nearest") can also nudge
    // the whole *page* vertically to bring the carousel fully into view,
    // including on first mount, which was auto-scrolling the home page
    // down to this section on every load.
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const track = trackRef.current;
    const card = track?.children[index] as HTMLElement | undefined;
    if (!track || !card) return;
    track.scrollTo({ left: card.offsetLeft, behavior: "smooth" });
  }, [index]);

  useEffect(() => {
    if (reviews.length <= 1) return;
    const id = setInterval(() => {
      if (!paused.current) setIndex((i) => (i + 1) % reviews.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [reviews.length, intervalMs]);

  if (!reviews.length) return null;

  return (
    <div
      className="relative max-w-7xl mx-auto px-0 lg:px-14"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      aria-roledescription="carousel"
      aria-label="Customer reviews"
    >
      {reviews.length > 1 ? (
        <div className="flex lg:hidden items-center justify-between mb-3 sm:mb-4">
          <ReviewNavButton direction="prev" onClick={() => go(index - 1)} />
          <ReviewNavButton direction="next" onClick={() => go(index + 1)} />
        </div>
      ) : null}

      <div
        ref={trackRef}
        className="flex gap-4 sm:gap-6 overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
      >
        {reviews.map((r) => (
          <figure
            key={r.id}
            className="w-full sm:w-[calc(50%-0.75rem)] shrink-0 snap-start bg-white p-6 sm:p-8 flex flex-col text-left"
          >
            <ReviewStars rating={r.rating} />
            <blockquote className="mt-3 sm:mt-4 flex-1 text-sm sm:text-[15px] leading-relaxed text-foreground">
              “{r.comments}”
            </blockquote>
            <figcaption className="mt-4 sm:mt-5 pt-3 sm:pt-4 border-t border-foreground/10 text-xs sm:text-[12px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                {r.reviewer}
              </span>
              {r.date ? ` · ${r.date}` : ""}
            </figcaption>
          </figure>
        ))}
      </div>

      {reviews.length > 1 ? (
        <>
          <ReviewNavButton
            direction="prev"
            onClick={() => go(index - 1)}
            className="hidden lg:grid absolute left-0 top-1/2 -translate-y-1/2"
          />
          <ReviewNavButton
            direction="next"
            onClick={() => go(index + 1)}
            className="hidden lg:grid absolute right-0 top-1/2 -translate-y-1/2"
          />
        </>
      ) : null}
    </div>
  );
}

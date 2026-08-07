"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

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

  if (!offers.length) return null;
  const offer = offers[index];

  return (
    <div
      className="bg-[#D3102F] text-white"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <div className="max-w-[1400px] mx-auto px-5 lg:px-10 h-[52px] flex items-center justify-center gap-4">
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
 * Victorian Plumbing–style full-bleed promo banners.
 * Artwork carries the messaging; each slide is a linked image.
 */
export type HeroSlide = {
  /** Desktop banner (~1920×550). */
  image: string;
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
      <div className="relative w-full overflow-hidden h-[320px] sm:h-[400px] md:h-[480px] lg:h-[550px]">
        {slides.map((slide, i) => {
          const active = i === index;
          return (
            <div
              key={`${slide.alt}-${i}`}
              className={cn(
                "absolute inset-0 transition-opacity duration-500",
                active ? "opacity-100 z-[1]" : "opacity-0 z-0 pointer-events-none",
              )}
              aria-hidden={!active}
            >
              <Link
                href={slide.href}
                className="relative block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D3102F] focus-visible:ring-inset"
              >
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

/** Static VP-style hero slides scraped from victorianplumbing.co.uk/tiles-decor */
export const VP_HERO_SLIDES: HeroSlide[] = [
  {
    image: "/hero/vp/trade-account.jpg",
    mobileImage: "/hero/vp/trade-account-mobile.jpg",
    href: "/contact",
    alt: "Trade Account",
  },
  {
    image: "/hero/vp/tile-sale-1.jpg",
    mobileImage: "/hero/vp/tile-sale-1-mobile.jpg",
    href: "/category?department=tiles",
    alt: "August Tile Sale — Free Delivery",
  },
  {
    image: "/hero/vp/tile-sale-2.jpg",
    mobileImage: "/hero/vp/tile-sale-2-mobile.jpg",
    href: "/category?department=tiles",
    alt: "Alana Tiles Sale — Free Delivery",
  },
];

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { BannerDecor } from "@/components/home/BannerDecor";

function money(value: number) {
  return `£${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

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

export type HeroSlide = {
  eyebrow: string;
  title: string;
  body: string;
  image: string;
  href: string;
  cta: string;
  fromPrice?: number;
  perSqm?: boolean;
  /** Live product count, used only for ordering slides. */
  productCount?: number;
  /** Oversized ghost word behind the panel. */
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
      className="relative"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      aria-roledescription="carousel"
    >
      <div className="relative">
          {slides.map((slide, i) => (
            <div
              key={`${slide.title}-${i}`}
              className={cn(
                "transition-opacity duration-500",
                i === index ? "opacity-100" : "hidden opacity-0",
              )}
              aria-hidden={i !== index}
            >
              {/*
                A solid dark-red panel rather than a photographic hero. The
                catalogue's photography is mostly cut-outs and component
                close-ups, which look poor full-bleed; a promotional block
                carries the message on its own and keeps the white type at
                full contrast.
              */}
              <div className="relative overflow-hidden bg-[#D3102F] text-white min-h-[340px] md:min-h-[400px] lg:min-h-[440px] flex">
                <BannerDecor word={slide.badgeWord || "TRADE"} />

                <div className="relative w-full max-w-[1400px] mx-auto px-6 lg:px-10 py-6 md:py-8">
                  <div className="border border-white/30 px-6 md:px-10 py-8 md:py-10 flex flex-col lg:flex-row lg:items-center gap-8">
                  <div className="flex-1">
                    <p className="text-[11px] md:text-xs uppercase tracking-[0.3em] font-bold text-white/80">
                      {slide.eyebrow}
                    </p>

                    <h1 className="mt-3 font-serif normal-case text-[clamp(2rem,4vw,3.15rem)] leading-[1.08] tracking-[0.01em]">
                      {slide.title}
                    </h1>

                    <p className="mt-4 max-w-lg text-[14px] md:text-[15px] text-white/85 leading-[1.55]">
                      {slide.body}
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <Link
                        href={slide.href}
                        className="px-8 py-3.5 bg-white text-foreground text-[12px] font-bold uppercase tracking-[0.18em] hover:bg-white/90 transition-colors"
                      >
                        {slide.cta}
                      </Link>
                      <Link
                        href="/contact"
                        className="px-7 py-3.5 border border-white/60 text-white text-[12px] font-bold uppercase tracking-[0.18em] hover:bg-white hover:text-foreground transition-colors"
                      >
                        Request a quote
                      </Link>
                    </div>
                  </div>

                  {slide.fromPrice ? (
                    <div className="shrink-0 self-start lg:self-center">
                      <div className="w-[130px] h-[130px] md:w-[152px] md:h-[152px] rounded-full bg-white text-[#D3102F] flex flex-col items-center justify-center text-center px-4 ring-1 ring-white/40 ring-offset-4 ring-offset-[#D3102F]">
                        <span className="text-[9px] uppercase tracking-[0.3em] font-bold opacity-70">
                          From
                        </span>
                        <span className="mt-1 font-serif text-[1.7rem] md:text-[2rem] leading-none">
                          {money(slide.fromPrice)}
                        </span>
                        {slide.perSqm ? (
                          <span className="mt-1 text-[11px] uppercase tracking-[0.2em] font-semibold opacity-70">
                            per m²
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {slides.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous slide"
                onClick={() => go(index - 1)}
                className="absolute left-4 lg:left-8 top-1/2 -translate-y-1/2 z-10 w-11 h-11 grid place-items-center bg-white/15 hover:bg-white/30 backdrop-blur-sm text-white border border-white/30 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label="Next slide"
                onClick={() => go(index + 1)}
                className="absolute right-4 lg:right-8 top-1/2 -translate-y-1/2 z-10 w-11 h-11 grid place-items-center bg-white/15 hover:bg-white/30 backdrop-blur-sm text-white border border-white/30 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {slides.length > 1 && (
            <div className="absolute bottom-5 left-0 right-0 z-10 flex items-center justify-center gap-2.5">
              {slides.map((s, i) => (
                <button
                  key={`dot-${s.title}-${i}`}
                  type="button"
                  aria-label={`Go to slide ${i + 1}`}
                  aria-current={i === index}
                  onClick={() => go(i)}
                  className={cn(
                    "h-1.5 transition-all",
                    i === index
                      ? "w-9 bg-white"
                      : "w-4 bg-white/45 hover:bg-white/70",
                  )}
                />
              ))}
            </div>
          )}
        </div>
    </section>
  );
}

import Image from "next/image";
import type { HeroSlide } from "@/components/home/LuxeCarousels";

/**
 * LINX Square hero banners — original artwork, composed in the browser.
 *
 * These replace three JPEGs scraped from a competitor's homepage.
 *
 * Styled after big-format trade advertising: oversized condensed uppercase,
 * angled colour slabs behind the key words, a solid block CTA and a line of
 * small print. Built from type and CSS rather than a flat JPEG, so it stays
 * sharp at any width, costs no image download beyond the photograph, and the
 * copy is edited here rather than in Photoshop.
 *
 * Every claim is limited to what the site actually does — free samples, £50
 * flat-rate UK delivery, per-m² pricing with a 10% wastage allowance, and
 * trade accounts on application. No invented discounts or delivery promises.
 */

const RED = "#D3102F";

export type BannerImage = { src: string; alt: string };

/**
 * Banner photography, curated by hand.
 *
 * Picking automatically ("newest product in this department") is unreliable
 * for a full-bleed hero — it happily returned a window handle cut out on
 * white. These three are room scenes from the catalogue, checked by eye.
 *
 * They are supplier photography already shown on the product pages, so this
 * is the same imagery the site uses elsewhere, not a new source.
 */
const CLOUDINARY = "https://res.cloudinary.com/diibcfikb/image/upload";

export const BANNER_SHOTS: Record<string, BannerImage> = {
  trade: {
    src: `${CLOUDINARY}/v1786042155/linx-living/products/mb-decor/decorfloor-natural-stone-genoa-flooring-2.jpg`,
    alt: "Dining room laid with natural stone effect flooring",
  },
  tiles: {
    src: `${CLOUDINARY}/v1785867757/linx-living/products/spectra/fix-calacatta-crema-2.jpg`,
    alt: "Living room with Calacatta marble tiled floor and feature wall",
  },
  flooring: {
    src: `${CLOUDINARY}/v1785873991/linx-living/products/natura-flooring/natura-valpolicella-oak-engineered-wood-flooring-15-4mm-2.jpg`,
    alt: "Engineered oak flooring in a warm natural finish",
  },
};

/* ------------------------------------------------------------- devices */

/**
 * Angled colour slab behind a word — the device that makes a trade banner
 * read as advertising rather than as a web page. Rotation alternates so a
 * stack of slabs looks hand-set rather than mechanical.
 *
 * Padding is in `em` so it tracks the type size, and the top is deliberately
 * heavier than the bottom: the line box reserves descender space below the
 * baseline that all-caps text never uses, so equal padding leaves the caps
 * sitting visibly high in the slab.
 */
function Slab({
  children,
  bg,
  fg,
  tilt = -2.4,
}: {
  children: React.ReactNode;
  bg: string;
  fg: string;
  tilt?: number;
}) {
  return (
    <span
      className="inline-block px-[0.3em] pb-[0.14em] pt-[0.24em] leading-[0.82]"
      style={{ backgroundColor: bg, color: fg, transform: `rotate(${tilt}deg)` }}
    >
      {children}
    </span>
  );
}

/** Oversized headline scale shared by all three banners. */
const DISPLAY =
  "font-sans font-black uppercase leading-[0.85] tracking-[-0.02em] text-[clamp(1.5rem,7vw,5rem)]";

/* --------------------------------------------------------------- shell */

function BannerShell({
  image,
  headline,
  kicker,
  cta,
  smallPrint,
  focal = "object-center",
  priority,
}: {
  image: BannerImage;
  /** The big stacked type block. */
  headline: React.ReactNode;
  /** Supporting line under the headline. */
  kicker: string;
  cta: string;
  smallPrint: string;
  focal?: string;
  priority?: boolean;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0d0d0d]">
      <Image
        src={image.src}
        alt={image.alt}
        fill
        priority={priority}
        sizes="100vw"
        className={`object-cover scale-105 ${focal}`}
      />

      {/* Even scrim, not left-weighted: the type is centred, so both edges of
          the headline need the same contrast. The vertical pass keeps the
          photograph readable behind the middle of the block. */}
      <div aria-hidden className="absolute inset-0 bg-black/42" />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/10 to-black/45"
      />

      <div className="relative flex h-full items-center justify-center site-container">
        <div className="mx-auto max-w-[900px] px-12 py-6 text-center sm:px-16 sm:py-8">
          <div
            className={DISPLAY}
            style={{ textShadow: "0 2px 24px rgba(0,0,0,0.45)" }}
          >
            {headline}
          </div>

          <p
            className="mx-auto mt-4 hidden max-w-[520px] text-[13px] font-medium leading-snug text-white/90 min-[420px]:block sm:mt-6 sm:text-[18px]">
            {kicker}
          </p>

          <span
            className="mt-5 inline-flex items-center px-6 py-3.5 text-[11px] font-black uppercase tracking-[0.12em] text-white sm:mt-6 sm:px-12 sm:py-4 sm:text-[14px] sm:tracking-[0.14em]"
            style={{ backgroundColor: RED }}
          >
            {cta}
          </span>

          {/* Small print is the first thing to go — at 320px the banner has
              no room for it and the CTA matters more. */}
          <p className="mx-auto mt-4 hidden max-w-[520px] text-[10px] uppercase leading-relaxed tracking-[0.14em] text-white/60 sm:block">
            {smallPrint}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- banners */

export function TradeAccountBanner({ image }: { image?: BannerImage }) {
  return (
    <BannerShell
      image={image || BANNER_SHOTS.trade}
      priority
      focal="object-[70%_center]"
      headline={
        <>
          <span className="block">
            <Slab bg="#ffffff" fg="#0d0d0d" tilt={-2.4}>
              Trade
            </Slab>
          </span>
          <span className="mt-2 block sm:mt-3">
            <Slab bg={RED} fg="#ffffff" tilt={1.6}>
              Account
            </Slab>
          </span>
          <span className="mt-3 block text-[clamp(1.05rem,2.9vw,2.2rem)] leading-[0.95] text-white sm:mt-4">
            Trade priced. Every range.
          </span>
        </>
      }
      kicker="Tiles, flooring, bathrooms, heating and rooflights — all at trade rates."
      cta="Apply now"
      smallPrint="Trade accounts subject to application · Free samples on request · £50 flat-rate UK delivery"
    />
  );
}

export function TilesBanner({ image }: { image?: BannerImage }) {
  return (
    <BannerShell
      image={image || BANNER_SHOTS.tiles}
      focal="object-[72%_center]"
      headline={
        <>
          <span className="block text-white">Tiles priced</span>
          <span className="mt-2 block sm:mt-3">
            <Slab bg={RED} fg="#ffffff" tilt={-2}>
              by the m²
            </Slab>
          </span>
          <span className="mt-3 block sm:mt-4">
            <Slab bg="#ffffff" fg="#0d0d0d" tilt={1.4}>
              <span className="text-[clamp(0.78rem,2.4vw,1.9rem)]">
                Free sample on every tile
              </span>
            </Slab>
          </span>
        </>
      }
      kicker="Enter your room size — the calculator works out the packs and prices it instantly."
      cta="Shop all tiles"
      smallPrint="Calculator adds the standard 10% wastage allowance and rounds up to whole packs"
    />
  );
}

export function FlooringBanner({ image }: { image?: BannerImage }) {
  return (
    <BannerShell
      image={image || BANNER_SHOTS.flooring}
      focal="object-center"
      headline={
        <>
          <span className="block">
            <Slab bg="#ffffff" fg="#0d0d0d" tilt={-2.2}>
              Free
            </Slab>{" "}
            <span className="text-white">samples</span>
          </span>
          <span className="mt-2 block text-[clamp(1.25rem,3.4vw,2.7rem)] leading-[0.95] text-white sm:mt-3">
            See the finish in your own light
          </span>
        </>
      }
      kicker="Laminate, LVT, engineered and herringbone — sampled at home before you commit."
      cta="Shop all flooring"
      smallPrint="Samples are a request, not a purchase — no payment taken · £50 flat-rate UK delivery"
    />
  );
}

/* -------------------------------------------------------------- slides */

/**
 * The homepage hero slides.
 *
 * Lives here rather than in LuxeCarousels because that module is
 * `"use client"` — a server component cannot call a function exported from a
 * client module, it only ever receives a client reference. This module has no
 * client hooks, so the server can build the slides and pass the rendered
 * banners down as `content`.
 */
export function buildHeroSlides(images?: {
  trade?: BannerImage;
  tiles?: BannerImage;
  flooring?: BannerImage;
}): HeroSlide[] {
  return [
    {
      content: <TradeAccountBanner image={images?.trade} />,
      href: "/contact?topic=Trade%20account",
      alt: "Trade account — trade pricing across every range",
    },
    {
      content: <TilesBanner image={images?.tiles} />,
      href: "/category?department=tiles",
      alt: "Tiles priced by the square metre, with a free sample on every tile",
    },
    {
      content: <FlooringBanner image={images?.flooring} />,
      href: "/category?department=flooring",
      alt: "Flooring — free samples on laminate, LVT, engineered and herringbone",
    },
  ];
}

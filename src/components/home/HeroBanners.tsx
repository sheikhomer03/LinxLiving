import Image from "next/image";
import Link from "next/link";
import { HeroTradeButton } from "@/components/home/HeroTradeButton";
import type { HeroSlide } from "@/components/home/LuxeCarousels";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/shipping";
import { cdnImageUrl } from "@/lib/productImage";

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
/**
 * Shopify hosts the imagery now, so these point at the Shopify CDN copies of
 * the same two product shots rather than the Cloudinary originals — the site
 * serves every image from one host.
 *
 * // const CLOUDINARY = "https://res.cloudinary.com/diibcfikb/image/upload";
 */
// Full URLs, not built from a base: Shopify appends its own hash and version
// to a filename, so the path cannot be constructed from the original name.

export const BANNER_SHOTS: Record<string, BannerImage> = {
  tilesFlooring: {
    src: "/images/trade-account-hero.jpg",
    alt: "Open-plan living and dining room with herringbone oak flooring",
  },
  tiles: {
    // Their newer banner shot, served from Shopify like the rest of the site.
    src: "https://cdn.shopify.com/s/files/1/1053/8385/4344/files/keklr2pe6pb0adsvulob.jpg?v=1786974407",
    alt: "Statuario Dallas Silver 60x120 glossy marble-effect tiles",
  },
  flooring: {
    src: "https://cdn.shopify.com/s/files/1/1053/8385/4344/files/natura-valpolicella-oak-engineered-wood-flooring-15-4mm-2.jpg?v=1786967681",
    alt: "Engineered oak flooring in a warm natural finish",
  },
};

/* ------------------------------------------------------------- devices */

/**
 * Colour slab behind a word — the device that makes a trade banner read as
 * advertising rather than as a web page.
 *
 * The slabs used to be rotated a couple of degrees each, alternating, to look
 * hand-set. Stacked three deep that read as discount advertising rather than
 * as a materials merchant, and it was the loudest thing on the page. They sit
 * straight now; `tilt` is kept so a single slab can still be angled where
 * that is wanted.
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
  tilt = 0,
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

/** A hero shortcut — one department or offer, reachable in a single tap. */
export type HeroQuickLink = { label: string; href: string };

/**
 * The shortcuts every banner carries.
 *
 * A shopper landing on the homepage had exactly one way in: whichever
 * department the current slide happened to be advertising. These put the
 * three main ranges, the sale and the trade counter one tap away regardless
 * of which slide is showing.
 *
 * "Free samples" is deliberately absent. It is the first promise in the strip
 * at the top of every page and there is nowhere on the site to send it —
 * ServiceStrip does not even link it. A chip pointing at an approximation
 * would be worse than no chip; it wants a real samples page first.
 *
 * Trade is absent for a different reason: it is not a destination but a
 * switch, so it sits beside the main call to action as HeroTradeButton
 * rather than among the shortcuts.
 */
const HERO_QUICK_LINKS: HeroQuickLink[] = [
  { label: "Tiles", href: "/category?department=tiles" },
  { label: "Flooring", href: "/category?department=flooring" },
  { label: "Bathrooms", href: "/category?department=bathrooms" },
  { label: "Sale", href: "/category?onSale=1" },
];

function BannerShell({
  image,
  headline,
  kicker,
  cta,
  ctaHref,
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
  /** Where the primary button goes — it is a real link now, not a slide-wide one. */
  ctaHref: string;
  smallPrint: string;
  focal?: string;
  priority?: boolean;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0d0d0d]">
      <Image
        src={cdnImageUrl(image.src, 1512)}
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
        className="absolute inset-0 bg-linear-to-b from-black/35 via-black/10 to-black/45"
      />

      <div className="relative flex h-full items-center justify-center site-container">
        <div className="mx-auto max-w-225 px-6 py-6 text-center sm:px-16 sm:py-8">
          <div
            className={DISPLAY}
            style={{ textShadow: "0 2px 24px rgba(0,0,0,0.45)" }}
          >
            {headline}
          </div>

          <p className="mx-auto mt-4 hidden max-w-130 text-[13px] font-medium leading-snug text-white/90 min-[420px]:block sm:mt-5 sm:text-[17px]">
            {kicker}
          </p>

          {/* Real links, not a styled span.
              The primary used to be a `<span>` inside a slide-wide anchor —
              it looked like a button but was not one, and nothing else could
              be added beside it without nesting anchors. */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:mt-6">
            <Link
              href={ctaHref}
              className="inline-flex items-center px-7 py-3.5 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-10 sm:py-4 sm:text-[14px] sm:tracking-[0.14em]"
              style={{ backgroundColor: RED }}
            >
              {cta}
            </Link>
            <HeroTradeButton />
          </div>

          {/* Shortcuts. Whichever slide is showing, the main ranges are one
              tap away — the hero previously offered only its own department. */}
          <nav
            aria-label="Shop by department"
            className="mt-5 flex flex-wrap items-center justify-center gap-2"
          >
            {HERO_QUICK_LINKS.map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="rounded-full border border-white/30 bg-black/25 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white/90 backdrop-blur-[2px] transition-colors hover:border-white hover:bg-white hover:text-[#0d0d0d] focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-[11px]"
              >
                {q.label}
              </Link>
            ))}
          </nav>

          {/* Small print is the first thing to go — at 320px the banner has
              no room for it and the CTA matters more. */}
          <p className="mx-auto mt-4 hidden max-w-130 text-[10px] uppercase leading-relaxed tracking-[0.14em] text-white/60 sm:block">
            {smallPrint}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- banners */

export function TilesFlooringBanner({ image }: { image?: BannerImage }) {
  return (
    <BannerShell
      image={image || BANNER_SHOTS.tilesFlooring}
      priority
      focal="object-center"
      headline={
        <>
          <span className="block">
            <Slab bg="#ffffff" fg="#0d0d0d" tilt={-2.4}>
              Tiles &amp;
            </Slab>
          </span>
          <span className="mt-2 block sm:mt-3">
            <Slab bg={RED} fg="#ffffff" tilt={1.6}>
              Flooring
            </Slab>
          </span>
          <span className="mt-3 block text-[clamp(1.05rem,2.9vw,2.2rem)] leading-[0.95] text-white sm:mt-4">
            Every room. Every finish.
          </span>
        </>
      }
      kicker="Porcelain and marble-effect tiles, laminate, LVT and engineered wood flooring — priced by the m² and sampled at home before you buy."
      cta="Shop tiles & flooring"
      ctaHref="/category"
      smallPrint={`Free samples on request · Free UK delivery over £${FREE_DELIVERY_THRESHOLD}`}
    />
  );
}

export function TilesBanner({
  image,
  fromPerSqm,
}: {
  image?: BannerImage;
  /** Cheapest live tile rate per m². Omitted when nothing is priced. */
  fromPerSqm?: number;
}) {
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
                {fromPerSqm
                  ? `From £${fromPerSqm.toFixed(2)} per m²`
                  : "Free sample on every tile"}
              </span>
            </Slab>
          </span>
        </>
      }
      kicker="Enter your room size — the calculator works out the packs and prices it instantly."
      cta="Shop all tiles"
      ctaHref="/category?department=tiles"
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
      ctaHref="/category?department=flooring"
      smallPrint={`Samples are a request, not a purchase — no payment taken · Free UK delivery over £${FREE_DELIVERY_THRESHOLD}`}
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
export function buildHeroSlides(
  images?: {
    tilesFlooring?: BannerImage;
    tiles?: BannerImage;
    flooring?: BannerImage;
  },
  /** Live catalogue figures, so the banner never quotes a stale price. */
  prices?: { tilesFromPerSqm?: number },
): HeroSlide[] {
  return [
    {
      content: <TilesFlooringBanner image={images?.tilesFlooring} />,
      interactive: true,
      href: "/category",
      alt: "Tiles and flooring — every room, every finish",
    },
    {
      content: (
        <TilesBanner
          image={images?.tiles}
          fromPerSqm={prices?.tilesFromPerSqm}
        />
      ),
      interactive: true,
      href: "/category?department=tiles",
      alt: "Tiles priced by the square metre, with a free sample on every tile",
    },
    {
      content: <FlooringBanner image={images?.flooring} />,
      interactive: true,
      href: "/category?department=flooring",
      alt: "Flooring — free samples on laminate, LVT, engineered and herringbone",
    },
  ];
}

import Link from "next/link";
import Image from "next/image";
import {
  Check,
  Star,
  PackageOpen,
  BadgePercent,
  Headset,
  Truck,
  Ruler,
} from "lucide-react";
import { DEFAULT_SUPPORT_PHONE } from "@/lib/support";
import type { CompanyReviewSummary } from "@/lib/reviewsIo";
import { REVIEWS_IO_URL } from "@/lib/reviewsIo";
import { sanitizeDisplayImageUrl } from "@/lib/productImage";
import { ProductCard } from "@/components/products/ProductCard";

/**
 * Home page sections in the Luxury Flooring layout: a promise strip, a
 * full-bleed offer hero, per-range price bands with product cards, a
 * "find your range" tile grid, a customer photo mosaic and a brand row.
 *
 * Everything is driven from real catalogue data — the "from" prices are the
 * cheapest live product in each range, per m² where the range is sold by area.
 */

function money(value: number) {
  return `£${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ------------------------------------------------------------------ promises */

/**
 * Service strip under the navigation — icon, bold headline, small supporting
 * line, in the builders'-merchant style.
 *
 * Every entry is a real service: samples are a free request, trade accounts
 * are open on application, the number is the live support line, delivery is
 * the flat rate charged at checkout, and the rating is pulled from Reviews.io
 * rather than typed in.
 */
export function LuxePromiseBar({
  reviews,
}: {
  reviews?: CompanyReviewSummary;
}) {
  const items = [
    {
      icon: PackageOpen,
      title: "Free Samples",
      detail: "See the finish before you commit",
    },
    {
      icon: BadgePercent,
      title: "Trade Account",
      detail: "Trade prices on every range",
    },
    {
      icon: Headset,
      title: "Expert Advice",
      detail: `Speak to our team · ${DEFAULT_SUPPORT_PHONE}`,
    },
    {
      icon: Truck,
      title: "UK Delivery",
      detail: "£50 flat rate, whatever the order",
    },
    reviews?.total
      ? {
          icon: Star,
          title: `Rated ${reviews.average.toFixed(2)}/5`,
          detail: `${reviews.total} reviews on Reviews.io`,
        }
      : {
          icon: Ruler,
          title: "Sold By The m²",
          detail: "Calculator on every tile and floor",
        },
  ];

  return (
    <div className="border-b border-foreground/10 bg-[#f6f1e9]">
      {/* One row at every width. Below lg it scrolls horizontally rather than
          wrapping into a tall block that pushes the hero down the page. */}
      <div
        className="no-scrollbar mx-auto flex max-w-350 snap-x snap-mandatory items-center gap-6
                   overflow-x-auto px-5 py-3 lg:justify-between lg:gap-6 lg:overflow-visible lg:px-10 lg:py-3.5"
      >
        {items.map(({ icon: Icon, title, detail }) => (
          <div
            key={title}
            className="flex shrink-0 snap-start items-center gap-2.5 lg:min-w-0 lg:shrink"
          >
            <Icon
              className="h-6 w-6 shrink-0 text-primary lg:h-7 lg:w-7"
              strokeWidth={1.6}
            />
            <div className="lg:min-w-0">
              <p className="whitespace-nowrap text-[12px] font-bold leading-tight text-foreground lg:truncate lg:text-[13px]">
                {title}
              </p>
              <p className="whitespace-nowrap text-[10px] leading-tight text-foreground/60 lg:truncate lg:text-[11px]">
                {detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- hero */

export function LuxeHero({
  image,
  shopLink,
  storeName,
  fromPrice,
}: {
  image?: string;
  shopLink: string;
  storeName: string;
  /** Cheapest live per-m² rate, shown as a proof point. */
  fromPrice?: number;
}) {
  const src = sanitizeDisplayImageUrl(image || "");

  return (
    <section className="relative h-110 md:h-135 lg:h-150 overflow-hidden bg-[#2b2723]">
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      ) : null}

      {/*
        Catalogue photography is inconsistent — some shots are bright product
        close-ups, which pale text disappears against. Rather than hope for a
        good image, the copy sits on its own dark panel on the left, with the
        photograph carrying the right-hand side. That keeps the hero legible
        whatever image the catalogue happens to supply.
      */}
      <div className="absolute inset-0 bg-linear-to-r from-black/85 via-black/60 to-black/20" />
      <div className="absolute inset-0 lg:hidden bg-black/40" />

      <div className="relative h-full max-w-350 mx-auto px-5 lg:px-10 flex items-center">
        <div className="max-w-xl text-white">
          <p className="text-[11px] uppercase tracking-[0.3em] font-bold text-white/80">
            Trade prices on every range
          </p>

          <h1 className="mt-4 font-serif normal-case text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.06] tracking-[-0.01em]">
            Everything the build needs, in one place
          </h1>

          <p className="mt-5 text-[15px] md:text-base text-white/85 leading-[1.65]">
            Tiles, flooring, bathrooms, heating and roof windows — supplied to
            trade professionals and private clients nationwide by {storeName}.
          </p>

          {fromPrice ? (
            <p className="mt-5 inline-flex items-baseline gap-2 bg-white/12 backdrop-blur-sm px-4 py-2.5 border border-white/25">
              <span className="text-[11px] uppercase tracking-[0.2em] font-bold text-white/75">
                Tiles &amp; flooring from
              </span>
              <span className="text-lg font-bold">{money(fromPrice)}m²</span>
            </p>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href={shopLink}
              className="px-8 py-3.5 bg-white text-foreground text-sm font-bold hover:bg-white/90 transition-colors"
            >
              Shop the catalogue
            </Link>
            <Link
              href="/contact"
              className="px-8 py-3.5 border border-white/60 text-white text-sm font-bold hover:bg-white hover:text-foreground transition-colors"
            >
              Request a quote
            </Link>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2">
            {[
              "Free samples",
              "Trade pricing",
              "Nationwide delivery",
            ].map((point) => (
              <li
                key={point}
                className="inline-flex items-center gap-2 text-[12px] text-white/80"
              >
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- range bands */

export type RangeBandProduct = {
  _id: string;
  name: string;
  images: string[];
  brandName?: string;
  brandSlug?: string;
  category?: string;
  subCategory?: string;
  stock?: number;
  price: number;
  perSqm: boolean;
  size?: string;
  /** Pre-promotion price, only set when a genuine discount applies. */
  wasPrice?: number;
  discountPercent?: number;
  /** True when this product's own sample flow charges for it (e.g. Otto
      Tiles) — suppresses the homepage "free sample" badge/CTA. */
  hasPaidSample?: boolean;
};

export type RangeBand = {
  slug: string;
  name: string;
  image?: string;
  fromPrice: number;
  perSqm: boolean;
  /** Total live products in the range — used to rank hero slides. */
  productCount?: number;
  products: RangeBandProduct[];
};

/**
 * Factory Direct Flooring–style department tiles under the hero:
 * full-bleed image with title + “from £X” overlaid at the bottom.
 */
export function ShopByDepartment({ bands }: { bands: RangeBand[] }) {
  if (!bands.length) return null;

  // First six in menu order — Flooring, Tiles, Wall Panels, Bathrooms … —
  // so the homepage tiles match the navbar rather than reordering by SKU
  // count, which pushed the main ranges below Lighting and Rooflights.
  const tiles = bands.slice(0, 6);

  return (
    <section className="bg-white border-t border-foreground/8">
      <div className="max-w-350 mx-auto px-5 lg:px-10 pt-10 md:pt-14 pb-4">
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          {tiles.map((band) => {
            const img = sanitizeDisplayImageUrl(
              band.image || band.products?.[0]?.images?.[0] || "",
            );
            const href = `/category?department=${encodeURIComponent(band.slug)}`;
            return (
              <Link
                key={band.slug}
                href={href}
                aria-label={`See our ${band.name} Products`}
                className="group relative block overflow-hidden rounded-lg aspect-3/2 bg-[#e8e4dc]"
              >
                {img ? (
                  <Image
                    src={img}
                    alt={band.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 33vw"
                    className="object-cover group-hover:scale-[1.04] transition-transform duration-500"
                  />
                ) : null}
                <div className="absolute inset-0 bg-linear-to-t from-black/55 via-black/15 to-transparent pointer-events-none group-hover:from-black/45 transition-colors duration-500" />
                <div className="absolute inset-x-0 bottom-0 p-3 md:p-4 text-center text-white">
                  <h3 className="text-[15px] md:text-xl xl:text-2xl font-semibold leading-none">
                    {band.name}
                  </h3>
                  <p className="mt-1.5 text-xs md:text-sm font-bold">
                    from {money(band.fromPrice)}
                    {band.perSqm ? (
                      <>
                        /m<sup>2</sup>
                      </>
                    ) : null}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Pill row of popular catalogue destinations (FDF “Popular Searches”).
 */
export function PopularSearches({ bands }: { bands: RangeBand[] }) {
  const links = [
    // Menu order here too, so every homepage section agrees with the navbar.
    ...bands.slice(0, 6).map((b) => ({
        label: b.name,
        href: `/category?department=${encodeURIComponent(b.slug)}`,
      })),
    { label: "Sale", href: "/category?onSale=1" },
  ];

  if (links.length < 2) return null;

  return (
    <section className="bg-white">
      <div className="max-w-350 mx-auto px-5 lg:px-10 pt-4 pb-10 md:pb-12">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-center gap-3 lg:gap-5">
          <h2 className="shrink-0 text-[15px] md:text-base font-bold text-center lg:text-left lg:pt-1">
            Popular Searches
          </h2>
          <div className="flex items-center gap-3 md:gap-4 overflow-x-auto pb-1 lg:pb-0 sm:justify-center lg:flex-wrap lg:overflow-visible">
            {links.map((link) => (
              <Link
                key={link.href + link.label}
                href={link.href}
                className="shrink-0 rounded-full bg-[#eceae5] hover:bg-[#e0ddd6] px-4 py-2 md:px-6 md:py-3 text-sm font-medium text-foreground/85 transition-colors whitespace-nowrap"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * “Best Selling {Department} from £X” product rows — FDF homepage pattern.
 */
export function BestSellingBands({ bands }: { bands: RangeBand[] }) {
  if (!bands.length) return null;

  // Menu order, not catalogue size. Sorting by product count put Lighting and
  // Rooflights at the top because they hold the most SKUs, which is not what a
  // shopper landing on the homepage is looking for. `bands` already arrives in
  // department order, so the homepage reads the same as the navbar:
  // Flooring, Tiles, Wall Panels, Bathrooms …
  const ordered = bands;

  return (
    <>
      {ordered.map((band, index) => {
        if (!band.products?.length) return null;
        const href = `/category?department=${encodeURIComponent(band.slug)}`;

        return (
          <section
            key={band.slug}
            className={index % 2 === 0 ? "bg-white" : "bg-[#f7f5f1]"}
          >
            <div className="max-w-350 mx-auto px-5 lg:px-10 py-10 md:py-14">
              <div className="flex flex-wrap items-end justify-between gap-4 mb-6 md:mb-8">
                <div>
                  <h2 className="text-xl md:text-2xl lg:text-[1.75rem] font-bold leading-tight tracking-[-0.01em]">
                    Best Selling {band.name}
                    {band.fromPrice > 0 ? (
                      <span className="ml-1.5 text-sm xl:text-base font-medium text-foreground/70">
                        from {money(band.fromPrice)}
                        {band.perSqm ? (
                          <>
                            /m<sup>2</sup>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </h2>
                </div>
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/70 hover:text-[#D3102F] transition-colors whitespace-nowrap"
                >
                  View All
                  <span aria-hidden>→</span>
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 md:gap-6 xl:grid-cols-4 items-stretch">
                {band.products.map((p) => {
                  const img = sanitizeDisplayImageUrl(p.images?.[0] || "");
                  const onPromo = Boolean(p.discountPercent && p.wasPrice);
                  return (
                    <ProductCard
                      key={p._id}
                      id={p._id}
                      name={p.name}
                      price={p.price}
                      image={img}
                      images={p.images}
                      category={p.category || band.name}
                      subCategory={p.subCategory}
                      department={band.slug}
                      brandName={p.brandName}
                      brandSlug={p.brandSlug}
                      size={p.size}
                      stock={p.stock}
                      perSqm={p.perSqm}
                      compareAtPrice={onPromo ? p.wasPrice : null}
                      salePercent={onPromo ? p.discountPercent : null}
                      hasPaidSample={Boolean(p.hasPaidSample)}
                      homeLayout
                    />
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

/** @deprecated Use BestSellingBands — kept for older imports. */
export function LuxeRangeBands({ bands }: { bands: RangeBand[] }) {
  return <BestSellingBands bands={bands} />;
}

/**
 * @deprecated Prefer ShopByDepartment (FDF-style tiles under the hero).
 */
export function LuxeRangeGrid({
  bands,
  sampleImage: _sampleImage,
}: {
  bands: RangeBand[];
  sampleImage?: string;
}) {
  return <ShopByDepartment bands={bands} />;
}

/* -------------------------------------------------------------- brands strip */

export function LuxeBrandRow({
  brands,
}: {
  brands: {
    _id: string;
    name: string;
    slug: string;
    image?: string;
    menuCount?: number;
    productCount?: number;
  }[];
}) {
  if (!brands.length) return null;

  /*
   * Only one brand currently has a logo. Dropping the rest in as raw images
   * meant product photos of a bath and a rooflight standing in as logos, at
   * whatever aspect ratio they happened to be — which looked broken.
   *
   * A uniform typographic grid is the honest, tidier answer: every brand gets
   * the same card, set in the display face, with its range count. Swap in real
   * logos via Admin → Brands and they will sit in the same boxes.
   */
  return (
    <section className="bg-white border-t border-foreground/8">
      <div className="max-w-350 mx-auto px-5 lg:px-10 py-14 md:py-20">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="font-serif normal-case text-3xl md:text-[2.6rem] leading-[1.1] tracking-[-0.01em]">
            The brands we stock
          </h2>
          <p className="mt-3 text-muted-foreground">
            Specified and supplied direct from the manufacturer.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-foreground/10 border border-foreground/10">
          {brands.map((b) => (
            <Link
              key={b._id}
              href={`/category?brand=${encodeURIComponent(b.slug)}`}
              className="group bg-white hover:bg-[#f6f1e9] transition-colors px-5 py-9 flex flex-col items-center justify-center text-center min-h-33"
            >
              <span className="font-serif normal-case text-lg md:text-xl leading-tight tracking-[-0.01em]">
                {b.name}
              </span>
              {b.productCount ? (
                <span className="mt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {b.productCount.toLocaleString("en-GB")} product
                  {b.productCount === 1 ? "" : "s"}
                </span>
              ) : null}
              <span className="mt-3 text-[11px] uppercase tracking-[0.18em] font-bold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                Shop brand
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ reviews */


function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className || ""}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${
            i <= Math.round(rating)
              ? "fill-[#00b67a] text-[#00b67a]"
              : "fill-foreground/15 text-foreground/15"
          }`}
        />
      ))}
    </span>
  );
}

/** Slim rating strip, sat directly beneath the hero. */
export function LuxeReviewBar({ summary }: { summary: CompanyReviewSummary }) {
  if (!summary.total) return null;
  return (
    <section className="bg-white border-b border-foreground/8">
      <div className="max-w-350 mx-auto px-5 lg:px-10 py-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
        {summary.word ? (
          <span className="font-bold">{summary.word}</span>
        ) : null}
        <Stars rating={summary.average} />
        <span className="text-foreground/70">
          {summary.average.toFixed(2)} average
        </span>
        <a
          href={REVIEWS_IO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-primary"
        >
          {summary.total.toLocaleString("en-GB")} reviews on Reviews.io
        </a>
      </div>
    </section>
  );
}

/** What customers say — a row of the most recent reviews. */
export function LuxeReviews({ summary }: { summary: CompanyReviewSummary }) {
  if (!summary.reviews.length) return null;
  return (
    <section className="bg-[#f6f1e9]">
      <div className="max-w-350 mx-auto px-5 lg:px-10 py-14 md:py-20">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="font-serif normal-case text-3xl md:text-[3rem] leading-[1.1] tracking-[-0.01em]">
            What our customers say
          </h2>
          <p className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-foreground/70">
            <Stars rating={summary.average} />
            <span>
              {summary.average.toFixed(2)} out of 5 from{" "}
              {summary.total.toLocaleString("en-GB")} verified reviews
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {summary.reviews.slice(0, 6).map((r) => (
            <figure
              key={r.id}
              className="bg-white p-6 flex flex-col h-full"
            >
              <Stars rating={r.rating} />
              <blockquote className="mt-4 flex-1 text-[14px] leading-relaxed text-foreground/85">
                “{r.comments}”
              </blockquote>
              <figcaption className="mt-5 pt-4 border-t border-foreground/10 text-[12px] text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {r.reviewer}
                </span>
                {r.date ? ` · ${r.date}` : ""}
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="mt-8 text-center">
          <a
            href={REVIEWS_IO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-7 py-3 border border-foreground/25 text-sm font-bold hover:bg-foreground hover:text-background transition-colors"
          >
            Read all reviews
          </a>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import Image from "next/image";
import { Check, Star } from "lucide-react";
import type { CompanyReviewSummary } from "@/lib/reviewsIo";
import { REVIEWS_IO_URL } from "@/lib/reviewsIo";
import { sanitizeDisplayImageUrl } from "@/lib/productImage";

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

export function LuxePromiseBar() {
  const promises = [
    "Fast, flexible delivery",
    "Trade prices, never retail markup",
    "Free samples before you commit",
  ];
  return (
    <div className="bg-[#f6f1e9] border-b border-foreground/8">
      <div className="max-w-[1400px] mx-auto px-5 lg:px-10 py-2.5 flex flex-wrap items-center justify-center gap-x-8 gap-y-1.5">
        {promises.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-2 text-[12px] font-medium text-foreground/80"
          >
            <Check className="w-3.5 h-3.5 text-primary" strokeWidth={3} />
            {p}
          </span>
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
    <section className="relative h-[440px] md:h-[540px] lg:h-[600px] overflow-hidden bg-[#2b2723]">
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
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/20" />
      <div className="absolute inset-0 lg:hidden bg-black/40" />

      <div className="relative h-full max-w-[1400px] mx-auto px-5 lg:px-10 flex items-center">
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
  stock?: number;
  price: number;
  perSqm: boolean;
  size?: string;
  /** Pre-promotion price, only set when a genuine discount applies. */
  wasPrice?: number;
  discountPercent?: number;
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

export function LuxeRangeBands({ bands }: { bands: RangeBand[] }) {
  if (!bands.length) return null;

  return (
    <>
      {bands.map((band, index) => (
        <section
          key={band.slug}
          className={index % 2 === 0 ? "bg-[#f6f1e9]" : "bg-white"}
        >
          <div className="max-w-[1400px] mx-auto px-5 lg:px-10 py-12 md:py-16">
            <div className="grid lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-3">
                <h2 className="font-serif normal-case text-3xl md:text-[2.6rem] leading-[1.1] tracking-[-0.01em]">
                  {band.name}
                </h2>
                <p className="mt-4 inline-block bg-white px-4 py-2.5 text-sm font-bold border border-foreground/10">
                  Prices from: {money(band.fromPrice)}
                  {band.perSqm ? "m²" : ""}
                </p>
                <div>
                  <Link
                    href={`/category?department=${encodeURIComponent(band.slug)}`}
                    className="mt-5 inline-block px-6 py-3.5 bg-foreground text-background text-[12px] font-bold uppercase tracking-[0.16em] hover:bg-foreground/85 transition-colors"
                  >
                    Shop {band.name} &gt;
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-9 bg-white p-5 md:p-7">
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 md:gap-7 items-stretch">
                  {band.products.map((p) => {
                    const img = sanitizeDisplayImageUrl(p.images?.[0] || "");
                    return (
                      <div
                        key={p._id}
                        className="flex flex-col h-full bg-white border border-foreground/10 hover:border-foreground/25 hover:shadow-sm transition-all"
                      >
                        <Link
                          href={`/products/${p._id}`}
                          className="relative block aspect-[4/3] bg-secondary overflow-hidden group"
                        >
                          {img ? (
                            <Image
                              src={img}
                              alt={p.name}
                              fill
                              sizes="(max-width: 1280px) 45vw, 22vw"
                              className="object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                          ) : null}

                          {/* Corner flag: the discount where the supplier list
                              carries one, otherwise the free-sample offer. */}
                          {p.discountPercent ? (
                            <span className="absolute top-0 left-0 z-10 bg-[#D3102F] text-white px-3.5 py-2 text-[13px] font-bold tracking-wide">
                              SALE
                            </span>
                          ) : (
                            <span className="absolute top-0 left-0 z-10 bg-[#D3102F] text-white px-3.5 py-2 text-[13px] font-bold tracking-wide">
                              FREE SAMPLE
                            </span>
                          )}

                          {/* Quick view, as on the reference card. */}
                          <span className="absolute inset-x-6 bottom-5 z-10 hidden group-hover:flex items-center justify-center bg-white/85 backdrop-blur-sm py-3 text-[12px] font-bold uppercase tracking-[0.18em]">
                            Quick view
                          </span>
                        </Link>

                        <div className="flex flex-col flex-1 p-4">
                          {p.brandName ? (
                            <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-foreground/55 mb-2">
                              {p.brandName}
                            </p>
                          ) : null}

                          <Link
                            href={`/products/${p._id}`}
                            className="text-[15px] font-semibold leading-snug hover:underline underline-offset-4"
                          >
                            {p.name}
                          </Link>

                          {/* Size reserved even when blank so every card's
                              price sits on the same line. */}
                          <p className="mt-1 min-h-[1.25rem] text-[13px] text-foreground/50">
                            {p.size || "\u00A0"}
                          </p>

                          <p className="mt-2 flex items-baseline gap-2 flex-wrap">
                            <span className="text-[21px] font-bold text-[#D3102F]">
                              {money(p.price)}
                              {p.perSqm ? (
                                <span className="text-[13px] align-super">/m²</span>
                              ) : null}
                            </span>
                            {p.wasPrice ? (
                              <span className="text-[13px] text-foreground/45 line-through">
                                Was {money(p.wasPrice)}
                                {p.perSqm ? "/m²" : ""}
                              </span>
                            ) : null}
                          </p>

                          <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold">
                            {(p.stock ?? 0) > 0 ? (
                              <>
                                <Check
                                  className="w-4 h-4 p-0.5 bg-[#1f8a4c] text-white"
                                  strokeWidth={4}
                                />
                                <span className="text-foreground/70">In Stock</span>
                              </>
                            ) : (
                              <span className="text-foreground/45">Made to order</span>
                            )}
                          </p>

                          <Link
                            href={`/products/${p._id}`}
                            className="mt-4 inline-flex items-center justify-center px-4 py-3 bg-foreground text-background text-[12px] font-bold uppercase tracking-[0.14em] hover:bg-foreground/85 transition-colors"
                          >
                            Order a free sample
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

/* ----------------------------------------------------------- find your range */

export function LuxeRangeGrid({
  bands,
  sampleImage,
}: {
  bands: RangeBand[];
  sampleImage?: string;
}) {
  if (!bands.length) return null;
  const sample = sanitizeDisplayImageUrl(sampleImage || "");

  return (
    <section className="bg-white">
      <div className="max-w-[1400px] mx-auto px-5 lg:px-10 py-14 md:py-20">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="font-serif normal-case text-3xl md:text-[3rem] leading-[1.1] tracking-[-0.01em]">
            Find your range
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Your project starts here. Take a look through the ranges we stock
            below.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="relative aspect-[4/3] bg-[#f6f1e9] flex flex-col items-center justify-center text-center p-8">
            {sample ? (
              <Image
                src={sample}
                alt=""
                fill
                sizes="(max-width: 1024px) 50vw, 33vw"
                className="object-cover opacity-90"
              />
            ) : null}
            <div className="relative">
              <p className="font-serif normal-case text-2xl md:text-[2rem] leading-tight">Free samples</p>
              <p className="mt-2 text-sm text-foreground/70">
                Order before you commit
              </p>
              <Link
                href="/category"
                className="mt-4 inline-block text-[11px] uppercase tracking-[0.2em] font-bold border-b border-foreground/40 pb-1"
              >
                Browse ranges
              </Link>
            </div>
          </div>

          {bands.slice(0, 5).map((band) => {
            const img = sanitizeDisplayImageUrl(
              band.image || band.products?.[0]?.images?.[0] || "",
            );
            return (
              <Link
                key={band.slug}
                href={`/category?department=${encodeURIComponent(band.slug)}`}
                className="relative aspect-[4/3] overflow-hidden group"
              >
                {img ? (
                  <Image
                    src={img}
                    alt={band.name}
                    fill
                    sizes="(max-width: 1024px) 50vw, 33vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                ) : (
                  <div className="absolute inset-0 bg-secondary" />
                )}
                <div className="absolute inset-0 bg-black/25 group-hover:bg-black/35 transition-colors" />
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white px-6">
                  <h3 className="font-serif normal-case text-2xl md:text-[2rem] leading-tight drop-shadow">
                    {band.name}
                  </h3>
                  <span className="mt-3 px-4 py-2 border border-white/70 text-[13px] font-bold">
                    Prices from: {money(band.fromPrice)}
                    {band.perSqm ? "m²" : ""}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
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
      <div className="max-w-[1400px] mx-auto px-5 lg:px-10 py-14 md:py-20">
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
              className="group bg-white hover:bg-[#f6f1e9] transition-colors px-5 py-9 flex flex-col items-center justify-center text-center min-h-[132px]"
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
      <div className="max-w-[1400px] mx-auto px-5 lg:px-10 py-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
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
      <div className="max-w-[1400px] mx-auto px-5 lg:px-10 py-14 md:py-20">
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

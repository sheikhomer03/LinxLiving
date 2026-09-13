import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { PageBanner } from "@/components/layout/PageBanner";
import { Footer } from "@/components/layout/Footer";
import { getStoreName } from "@/app/actions/settings";
import { BANNER_SHOTS } from "@/components/home/HeroBanners";
import {
  COMPANY,
  COMPANY_MAP_HREF,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_EMAIL,
} from "@/lib/company";
import { TRADE_DISCOUNT_PERCENT } from "@/lib/trade";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/shipping";

export const metadata: Metadata = {
  title: "About Us | Linx Square",
  description:
    "Linx Square supplies architectural tiles, flooring, bathrooms and finishes at trade prices — straightforward pricing, free samples and UK-wide delivery.",
  alternates: { canonical: "/about" },
};

const BANNER_IMAGE = "/images/trade-account-hero.jpg";

/**
 * The four propositions, numbered rather than iconed.
 *
 * The icons went with the old layout: a gold glyph in a ring is not a mark this
 * design system makes anywhere else, and four of them in a row read as a
 * feature grid from a different site. The reference numbers its editorial
 * lists, so these are numbered.
 */
const VALUES = [
  {
    title: "Trade Prices",
    body: "Every range on the site is priced to the trade, not marked up for retail — the price you see is the price we'd quote a fitter.",
  },
  {
    title: "Free Samples",
    body: "Colour and finish never read the same on a screen as they do in your room. Request a physical sample before you commit — it's a request, not a purchase.",
  },
  {
    title: "UK Delivery",
    body: `£50 flat-rate delivery across the UK, free on orders over £${FREE_DELIVERY_THRESHOLD}.`,
  },
  {
    title: "FENSA Fitting",
    body: "Professional, FENSA-registered installation is available wherever you need a pair of hands as well as the materials.",
  },
];

const GALLERY = [
  {
    src: "/images/tiles1.jpg",
    alt: "Herringbone engineered oak flooring, close detail",
  },
  { src: "/images/tiles3.jpg", alt: "Handmade terracotta floor tiles" },
  { src: "/images/tiles4.jpg", alt: "Geometric hexagonal wall tiles" },
  { src: "/images/tiles2.jpg", alt: "Ornate patterned marble floor border" },
  { src: "/images/tiles5.jpg", alt: "Reeded glass texture" },
  { src: "/images/tiles6.jpg", alt: "Textured material detail" },
];

const STATS = [
  {
    value: `${TRADE_DISCOUNT_PERCENT}%`,
    label: "Trade discount, applied automatically",
  },
  { value: `£${FREE_DELIVERY_THRESHOLD}`, label: "Free UK delivery threshold" },
  { value: "£50", label: "Flat-rate delivery under that" },
  { value: "0", label: "Payment taken for a sample" },
];

/** The page's small caps, set once — every eyebrow on the site uses these. */
const EYEBROW =
  "font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/45 lg:text-[10px]";

export default async function AboutPage() {
  const storeName = await getStoreName();

  return (
    <main className="min-h-screen bg-background">
      <StorefrontNavbar overlay />

      <PageBanner image={BANNER_IMAGE} title="About" />

      {/* Story — the page's opening statement, set as the closing editorial
          block on the homepage is: centred prose on white, nothing else. */}
      <section className="px-4 py-14 lg:px-8 lg:py-20">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="order-2 lg:order-1">
            <p className={EYEBROW}>Who we are</p>
            <h2 className="mt-4 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
              A trade-first catalogue, built for real projects
            </h2>
            <div className="mt-6 space-y-4 text-[13px] leading-relaxed text-foreground/75 sm:text-sm">
              <p>
                We built {storeName} around one idea: everyone shopping for
                tiles, flooring, bathrooms or finishes should see the same
                honest price — no retail markup held back for a haggle, no
                account required to find out what something actually costs.
              </p>
              <p>
                Every range is sampled before it&apos;s specified. Because our
                premium stone and hand-finished ceramics are natural,
                hand-crafted materials, gentle variation in veining, tone and
                texture is expected — it&apos;s part of what makes the finish
                real, not a fault.
              </p>
              <p>
                Approved trade accounts get {TRADE_DISCOUNT_PERCENT}% off every
                order automatically, and every customer — trade or not — gets
                the same flat-rate delivery, free sample requests and
                FENSA-registered installation support.
              </p>
            </div>
          </div>

          {/* Square corners, no shadow: every photograph on the converted
              pages is a plain rectangle of image. */}
          <div className="relative order-1 aspect-[4/3] overflow-hidden bg-secondary/40 lg:order-2">
            <Image
              src={BANNER_SHOTS.flooring.src}
              alt={BANNER_SHOTS.flooring.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* Stats — a hairline band, figures in ink rather than gold. */}
      <section className="border-y border-black/10">
        <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-y-8 px-4 py-10 lg:grid-cols-4 lg:gap-8 lg:px-8 lg:py-12">
          {STATS.map((stat) => (
            <div key={stat.label}>
              <p className="text-2xl font-medium tabular-nums text-foreground sm:text-3xl">
                {stat.value}
              </p>
              <p className="mt-2 max-w-[14rem] text-[11px] leading-snug text-foreground/55">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Values */}
      <section className="px-4 py-14 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-[1200px]">
          <p className={EYEBROW}>Why shop with us</p>
          <h2 className="mt-4 max-w-2xl text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
            Everything you need to specify with confidence
          </h2>

          <ul className="mt-10 grid grid-cols-1 gap-px border border-black/10 bg-black/10 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((value, i) => (
              <li key={value.title} className="bg-background p-6 lg:p-8">
                <span className="font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/30 lg:text-[10px]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground sm:text-xs">
                  {value.title}
                </h3>
                <p className="mt-3 text-[12px] leading-relaxed text-foreground/65 sm:text-[13px]">
                  {value.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Material gallery — the catalogue index's card grid, without captions:
          these are textures, not categories, so there is nothing to link to. */}
      <section className="border-t border-black/10 px-4 py-14 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className={EYEBROW}>Materials</p>
              <h2 className="mt-4 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
                Finishes worth specifying
              </h2>
            </div>
            <Link
              href="/category"
              className="group font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-foreground lg:text-[10px]"
            >
              Browse the catalogue
              <ArrowRight className="ml-2 inline-block h-3 w-3 shrink-0 align-middle transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>

          <ul
            role="list"
            className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6"
          >
            {GALLERY.map((shot) => (
              <li
                key={shot.src}
                className="group relative aspect-square overflow-hidden bg-secondary/40"
              >
                <Image
                  src={shot.src}
                  alt={shot.alt}
                  fill
                  sizes="(max-width: 768px) 50vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Closing CTA — the homepage's banner treatment reduced to type: white
          on black, square buttons, no photograph to compete with the gallery
          immediately above it. */}
      <section className="bg-black px-4 py-16 text-white lg:px-8 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-xl font-medium uppercase leading-tight sm:text-2xl">
            Ready to start your project?
          </h2>
          <p className="mt-4 text-[13px] leading-relaxed text-white/70 sm:text-sm">
            Browse the full catalogue, request free samples before you commit,
            or speak to the team about specification, delivery and fitting for
            your job.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/category"
              className="bg-white px-8 py-3 text-[10px] font-medium uppercase tracking-[0.22em] text-black transition-colors hover:bg-white/85"
            >
              Shop the catalogue
            </Link>
            <Link
              href="/contact"
              className="border border-white/40 px-8 py-3 text-[10px] font-medium uppercase tracking-[0.22em] text-white transition-colors hover:border-white hover:bg-white hover:text-black"
            >
              Contact us
            </Link>
          </div>
        </div>
      </section>

      {/* Registered particulars */}
      <section className="px-4 py-14 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-[1200px]">
          <p className={EYEBROW}>Registered office</p>
          <ul className="mt-6 grid grid-cols-1 border-t border-black/10 sm:grid-cols-3 sm:border-t-0">
            <li className="sm:border-t sm:border-black/10">
              <a
                href={COMPANY_MAP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full items-start justify-between gap-4 border-b border-black/10 py-5 pr-4 transition-colors hover:bg-black/[0.02] sm:border-b-0"
              >
                <span className="text-[13px] leading-relaxed text-foreground/80">
                  {COMPANY.address.line1}
                  <br />
                  {COMPANY.address.city} {COMPANY.address.postcode}
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 stroke-[1.5] text-foreground/35 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
                />
              </a>
            </li>
            <li className="sm:border-t sm:border-black/10">
              <Link
                href={`tel:${DEFAULT_SUPPORT_PHONE.replace(/\s+/g, "")}`}
                className="flex h-full items-start border-b border-black/10 py-5 pr-4 text-[13px] text-foreground/80 transition-colors hover:text-foreground sm:border-b-0"
              >
                {DEFAULT_SUPPORT_PHONE}
              </Link>
            </li>
            <li className="sm:border-t sm:border-black/10">
              <Link
                href={`mailto:${DEFAULT_SUPPORT_EMAIL}`}
                className="flex h-full items-start border-b border-black/10 py-5 pr-4 text-[13px] break-all text-foreground/80 transition-colors hover:text-foreground sm:border-b-0"
              >
                {DEFAULT_SUPPORT_EMAIL}
              </Link>
            </li>
          </ul>
          <p className="mt-6 text-[11px] leading-relaxed text-foreground/45">
            {COMPANY.legalName} · Registered in {COMPANY.address.country} no.{" "}
            {COMPANY.number}
          </p>
        </div>
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}

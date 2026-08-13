import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Award, Truck, Shield, PackageOpen, MapPin, Phone, Mail } from "lucide-react";
import type { Metadata } from "next";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { Footer } from "@/components/layout/Footer";
import { getStoreName } from "@/app/actions/settings";
import { BANNER_SHOTS } from "@/components/home/HeroBanners";
import { COMPANY, COMPANY_MAP_HREF, DEFAULT_SUPPORT_PHONE, DEFAULT_SUPPORT_EMAIL } from "@/lib/company";
import { TRADE_DISCOUNT_PERCENT } from "@/lib/trade";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/shipping";

export const metadata: Metadata = {
  title: "About Us | Linx Square",
  description:
    "Linx Square supplies architectural tiles, flooring, bathrooms and finishes at trade prices — straightforward pricing, free samples and UK-wide delivery.",
  alternates: { canonical: "/about" },
};

const VALUES = [
  {
    icon: Award,
    title: "Trade Prices",
    body: "Every range on the site is priced to the trade, not marked up for retail — the price you see is the price we'd quote a fitter.",
  },
  {
    icon: PackageOpen,
    title: "Free Samples",
    body: "Colour and finish never read the same on a screen as they do in your room. Request a physical sample before you commit — it's a request, not a purchase.",
  },
  {
    icon: Truck,
    title: "UK Delivery",
    body: `£50 flat-rate delivery across the UK, free on orders over £${FREE_DELIVERY_THRESHOLD}.`,
  },
  {
    icon: Shield,
    title: "FENSA Fitting",
    body: "Professional, FENSA-registered installation is available wherever you need a pair of hands as well as the materials.",
  },
];

const GALLERY = [
  { src: "/images/tiles1.jpg", alt: "Herringbone engineered oak flooring, close detail" },
  { src: "/images/tiles3.jpg", alt: "Handmade terracotta floor tiles" },
  { src: "/images/tiles4.jpg", alt: "Geometric hexagonal wall tiles" },
  { src: "/images/tiles2.jpg", alt: "Ornate patterned marble floor border" },
  { src: "/images/tiles5.jpg", alt: "Reeded glass texture" },
  { src: "/images/tiles6.jpg", alt: "Textured material detail" },
];

const STATS = [
  { value: `${TRADE_DISCOUNT_PERCENT}%`, label: "Trade discount, applied automatically" },
  { value: `£${FREE_DELIVERY_THRESHOLD}`, label: "Free UK delivery threshold" },
  { value: "£50", label: "Flat-rate delivery under that" },
  { value: "0", label: "Payment taken for a sample" },
];

export default async function AboutPage() {
  const storeName = await getStoreName();

  return (
    <main className="min-h-screen bg-background">
      <StorefrontNavbar />

      {/* Hero */}
      <section className="page-top">
        <div className="relative min-h-120 sm:min-h-128 lg:h-144 w-full overflow-hidden bg-[#0d0d0d]">
          <Image
            src="/images/trade-account-hero.png"
            alt="Herringbone engineered oak flooring in a bright, open-plan living room"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div aria-hidden className="absolute inset-0 bg-black/55" />
          <div
            aria-hidden
            className="absolute inset-0 bg-linear-to-t from-black/70 via-black/20 to-black/40"
          />

          <div className="relative flex flex-col justify-center site-container py-14 sm:py-16 lg:h-full lg:py-0">
            <nav className="flex flex-wrap items-center gap-1.5 text-[9px] sm:text-[10px] uppercase tracking-widest text-white/70 font-bold">
              <Link href="/" className="hover:text-white transition-colors">
                Home
              </Link>
              <ChevronRight className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              <span className="text-white">About</span>
            </nav>

            <p className="mt-4 sm:mt-6 text-[10px] sm:text-[11px] uppercase tracking-[0.3em] sm:tracking-[0.4em] font-bold text-primary">
              Our story
            </p>
            <h1 className="mt-2 sm:mt-3 max-w-3xl font-serif text-3xl sm:text-5xl md:text-6xl leading-[1.1] sm:leading-[1.05] tracking-tight text-white">
              Trade prices.
              <br />
              Real materials.
            </h1>
            <p className="mt-4 sm:mt-5 max-w-xl text-[13px] sm:text-base leading-relaxed text-white/85">
              {storeName} supplies architectural tiles, flooring, bathrooms and
              finishes at trade prices — with the samples, delivery and
              installation support to see a project through.
            </p>

            <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Link
                href="/category"
                className="bg-primary text-primary-foreground px-6 sm:px-8 py-3.5 sm:py-4 uppercase tracking-widest text-[10px] font-bold text-center hover:bg-white hover:text-black transition-all"
              >
                Shop the catalogue
              </Link>
              <Link
                href="/contact"
                className="border border-white/40 text-white px-6 sm:px-8 py-3.5 sm:py-4 uppercase tracking-widest text-[10px] font-bold text-center hover:bg-white hover:text-black hover:border-white transition-all"
              >
                Get in touch
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="site-container py-16 md:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-20 items-center">
          <div className="space-y-6 order-2 lg:order-1">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
              Who we are
            </p>
            <h2 className="font-serif text-2xl sm:text-3xl md:text-[2.3rem] leading-tight tracking-tight">
              A trade-first catalogue, built for real projects
            </h2>
            <p className="text-foreground/75 leading-relaxed text-[15px] md:text-base">
              We built {storeName} around one idea: everyone shopping for tiles,
              flooring, bathrooms or finishes should see the same honest price —
              no retail markup held back for a haggle, no account required to
              find out what something actually costs.
            </p>
            <p className="text-foreground/75 leading-relaxed text-[15px] md:text-base">
              Every range is sampled before it&apos;s specified. Because our premium
              stone and hand-finished ceramics are natural, hand-crafted
              materials, gentle variation in veining, tone and texture is
              expected — it&apos;s part of what makes the finish real, not a fault.
            </p>
            <p className="text-foreground/75 leading-relaxed text-[15px] md:text-base">
              Approved trade accounts get {TRADE_DISCOUNT_PERCENT}% off every
              order automatically, and every customer — trade or not — gets the
              same flat-rate delivery, free sample requests and FENSA-registered
              installation support.
            </p>
          </div>

          <div className="order-1 lg:order-2 relative aspect-4/3 rounded-xl overflow-hidden border border-foreground/10 shadow-sm">
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

      {/* Stats */}
      <section className="border-y border-foreground/10 bg-[#f7f5f1]">
        <div className="site-container py-10 md:py-12">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center lg:text-left">
                <p className="font-serif text-3xl sm:text-4xl tracking-tight text-primary">
                  {stat.value}
                </p>
                <p className="mt-1.5 text-[11px] sm:text-xs uppercase tracking-wide text-foreground/60 leading-snug">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="site-container py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center space-y-4 mb-12 md:mb-16">
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
            Why shop with us
          </p>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-[2.1rem] leading-tight tracking-tight">
            Everything you need to specify with confidence
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 lg:gap-8">
          {VALUES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="bg-white border border-foreground/10 p-4 sm:p-7 space-y-2.5 sm:space-y-4 shadow-sm hover:shadow-md hover:border-foreground/20 transition-all"
            >
              <div className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border border-foreground/10 bg-secondary/40">
                <Icon className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-primary" strokeWidth={1.5} />
              </div>
              <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wide text-foreground">
                {title}
              </h3>
              <p className="text-[11px] sm:text-[13px] leading-relaxed text-foreground/65">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Material gallery */}
      <section className="bg-[#f7f5f1] border-y border-foreground/10">
        <div className="site-container py-16 md:py-24">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-10 md:mb-12">
            <div className="max-w-xl space-y-3">
              <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
                Materials
              </p>
              <h2 className="font-serif text-2xl sm:text-3xl md:text-[2.1rem] leading-tight tracking-tight">
                Finishes worth specifying
              </h2>
            </div>
            <Link
              href="/category"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/70 hover:text-primary transition-colors whitespace-nowrap"
            >
              Browse the catalogue
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
            {GALLERY.map((shot) => (
              <div
                key={shot.src}
                className="group relative aspect-square overflow-hidden rounded-xl border border-foreground/10 bg-white"
              >
                <Image
                  src={shot.src}
                  alt={shot.alt}
                  fill
                  sizes="(max-width: 768px) 50vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Registered particulars + CTA */}
      <section className="site-container py-16 md:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          <div className="lg:col-span-2 bg-foreground text-background p-8 sm:p-12 flex flex-col justify-center space-y-6">
            <h3 className="font-serif text-2xl sm:text-3xl tracking-tight">
              Ready to start your project?
            </h3>
            <p className="text-background/75 leading-relaxed max-w-lg">
              Browse the full catalogue, request free samples before you
              commit, or speak to the team about specification, delivery and
              fitting for your job.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/category"
                className="bg-primary text-primary-foreground px-8 py-4 uppercase tracking-widest text-[10px] font-bold hover:bg-white hover:text-black transition-all"
              >
                Shop the catalogue
              </Link>
              <Link
                href="/contact"
                className="border border-background/30 px-8 py-4 uppercase tracking-widest text-[10px] font-bold hover:bg-white hover:text-black hover:border-white transition-all"
              >
                Contact us
              </Link>
            </div>
          </div>

          <div className="bg-white border border-foreground/10 p-8 space-y-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-foreground/50">
              Registered office
            </p>
            <a
              href={COMPANY_MAP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 text-sm text-foreground/80 hover:text-primary transition-colors"
            >
              <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {COMPANY.address.line1}
                <br />
                {COMPANY.address.city} {COMPANY.address.postcode}
              </span>
            </a>
            <Link
              href={`tel:${DEFAULT_SUPPORT_PHONE.replace(/\s+/g, "")}`}
              className="flex items-center gap-3 text-sm text-foreground/80 hover:text-primary transition-colors"
            >
              <Phone className="w-4 h-4 shrink-0" />
              {DEFAULT_SUPPORT_PHONE}
            </Link>
            <Link
              href={`mailto:${DEFAULT_SUPPORT_EMAIL}`}
              className="flex items-center gap-3 text-sm text-foreground/80 hover:text-primary transition-colors"
            >
              <Mail className="w-4 h-4 shrink-0" />
              {DEFAULT_SUPPORT_EMAIL}
            </Link>
            <p className="pt-3 border-t border-foreground/10 text-[11px] leading-relaxed text-foreground/45">
              {COMPANY.legalName} · Registered in {COMPANY.address.country} no.{" "}
              {COMPANY.number}
            </p>
          </div>
        </div>
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}

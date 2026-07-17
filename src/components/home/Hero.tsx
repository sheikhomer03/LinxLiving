import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

interface QuickLink {
  label: string;
  href: string;
}

const DEFAULT_QUICK_LINKS: QuickLink[] = [
  { label: "Tiles & surfaces", href: "/new-arrivals" },
  { label: "Bathroom", href: "/new-arrivals" },
  { label: "Kitchen", href: "/new-arrivals" },
  { label: "Bespoke", href: "/custom" },
];

const PILLARS = [
  { label: "Materials", detail: "Stone, porcelain & fine ceramic" },
  { label: "Projects", detail: "Residential & commercial spaces" },
  { label: "Service", detail: "Support from enquiry to installation" },
];

interface HeroImage {
  src: string;
  alt: string;
  href?: string;
  caption?: string;
}

interface HeroProps {
  storeName: string;
  initialShopLink?: string;
  quickLinks?: QuickLink[];
  /** Primary + secondary product images from the catalogue */
  images?: HeroImage[];
}

export function Hero({
  storeName,
  initialShopLink = "/new-arrivals",
  quickLinks = DEFAULT_QUICK_LINKS,
  images = [],
}: HeroProps) {
  const primary = images[0];
  const secondary = images[1];
  const primaryHref = primary?.href || initialShopLink;
  const secondaryHref = secondary?.href || "/new-arrivals";

  return (
    <section className="relative overflow-hidden bg-background">
      {/* Decorative backdrop — oversized serif word + soft tonal wash */}
      <span
        aria-hidden
        className="pointer-events-none select-none absolute -bottom-10 -left-4 font-serif text-[22vw] leading-none text-foreground/[0.035] whitespace-nowrap"
      >
        Refined
      </span>
      <div
        aria-hidden
        className="pointer-events-none absolute top-24 right-[-10%] h-[32rem] w-[32rem] rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative max-w-[1600px] mx-auto px-6 lg:px-16 xl:px-24 pt-28 md:pt-44 lg:pt-48 pb-20 md:pb-24 lg:min-h-[100svh] flex flex-col justify-center">
        <div className="grid lg:grid-cols-12 gap-14 lg:gap-10 xl:gap-16 items-center">
          {/* Left — editorial content */}
          <div className="lg:col-span-6 xl:col-span-5 space-y-6 md:space-y-7">
            <p className="text-[10px] md:text-[11px] uppercase tracking-[0.4em] font-bold text-primary animate-[fade-up_0.7s_ease-out_both] motion-reduce:animate-none">
              {storeName}
              <span className="mx-3 text-foreground/30" aria-hidden>
                —
              </span>
              <span className="text-foreground/60">New collection 2026</span>
            </p>

            <h1 className="font-serif text-5xl md:text-6xl xl:text-7xl leading-[1.04] text-foreground animate-[fade-up_0.8s_ease-out_0.08s_both] motion-reduce:animate-none">
              Surfaces for
              <br />
              <span className="italic text-foreground/80">refined</span> living.
            </h1>

            <p className="text-muted-foreground text-sm md:text-base leading-relaxed max-w-md animate-[fade-up_0.9s_ease-out_0.16s_both] motion-reduce:animate-none">
              Stone, ceramic, and architectural finishes curated for bathrooms,
              kitchens, and interiors that last — from showroom floor to site.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 pt-2 animate-[fade-up_0.9s_ease-out_0.24s_both] motion-reduce:animate-none">
              <Link
                href={initialShopLink}
                className="group inline-flex items-center justify-center gap-3 px-10 py-4 bg-foreground text-background uppercase tracking-[0.25em] text-[11px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors duration-500"
              >
                Shop collections
                <ArrowRight className="w-3.5 h-3.5 transition-transform duration-500 group-hover:translate-x-1" />
              </Link>
              <Link
                href="/custom"
                className="group inline-flex items-center justify-center sm:justify-start gap-2 uppercase tracking-[0.25em] text-[11px] font-bold text-foreground border-b border-foreground/25 pb-1 hover:border-primary hover:text-primary transition-colors duration-300 self-center sm:self-auto"
              >
                Bespoke enquiry
                <ArrowUpRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>

            {/* Category shortcuts */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-4 text-[10px] uppercase tracking-[0.22em] font-bold text-foreground/45 animate-[fade-up_0.9s_ease-out_0.32s_both] motion-reduce:animate-none">
              <span className="text-foreground/30">Popular</span>
              {quickLinks.slice(0, 4).map((link, i) => (
                <span key={link.label} className="inline-flex items-center gap-3">
                  {i > 0 && (
                    <span className="text-foreground/20" aria-hidden>
                      /
                    </span>
                  )}
                  <Link
                    href={link.href}
                    className="hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </span>
              ))}
            </div>
          </div>

          {/* Right — layered imagery */}
          <div className="lg:col-span-6 xl:col-span-7">
            <div className="relative mx-auto max-w-[600px] lg:ml-auto lg:mr-0 pb-14 md:pb-20 pl-6 md:pl-16 animate-[fade-up_1s_ease-out_0.2s_both] motion-reduce:animate-none">
              {/* Hairline frame offset behind the main image */}
              <div
                aria-hidden
                className="absolute top-[-1.25rem] right-[-1.25rem] hidden md:block w-3/4 h-3/4 border border-primary/30"
              />

              {/* Main image */}
              <Link
                href={primaryHref}
                className="group relative block aspect-[4/5] overflow-hidden bg-secondary"
              >
                {primary?.src ? (
                  <Image
                    src={primary.src}
                    alt={primary.alt || "Featured surface"}
                    fill
                    priority
                    className="object-cover object-[center_62%] transition-transform duration-[1200ms] ease-out group-hover:scale-105"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent pointer-events-none" />

                {/* Floating caption card */}
                <span className="absolute bottom-5 right-5 inline-flex items-center gap-2.5 bg-white/95 backdrop-blur px-5 py-3.5 text-[10px] uppercase tracking-[0.22em] font-bold text-foreground shadow-lg max-w-[85%]">
                  <span className="truncate">
                    {primary?.caption || "New in · Stone & ceramic"}
                  </span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-primary shrink-0 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </Link>

              {/* Offset secondary image */}
              <Link
                href={secondaryHref}
                className="group/small absolute bottom-0 left-0 block w-[46%] max-w-[250px] aspect-square overflow-hidden border-[6px] border-background bg-secondary shadow-[0_24px_60px_rgba(0,0,0,0.18)]"
              >
                {secondary?.src ? (
                  <Image
                    src={secondary.src}
                    alt={secondary.alt || "Featured finish detail"}
                    fill
                    className="object-cover object-[center_58%] transition-transform duration-[1200ms] ease-out group-hover/small:scale-105"
                    sizes="(max-width: 1024px) 50vw, 25vw"
                  />
                ) : null}
              </Link>
            </div>
          </div>
        </div>

        {/* Trust pillars */}
        <div className="mt-16 md:mt-20 border-t border-foreground/10 pt-8 md:pt-10 grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6 animate-[fade-up_1s_ease-out_0.4s_both] motion-reduce:animate-none">
          {PILLARS.map((item) => (
            <div key={item.label} className="space-y-1.5">
              <p className="font-serif text-base md:text-lg tracking-[0.08em] uppercase text-foreground">
                {item.label}
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed tracking-wide">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

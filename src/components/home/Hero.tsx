import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

interface QuickLink {
  label: string;
  href: string;
}

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
  images?: HeroImage[];
}

export function Hero({
  storeName,
  initialShopLink = "/new-arrivals",
  quickLinks = [],
  images = [],
}: HeroProps) {
  const primary = images[0];
  const secondary = images[1];

  return (
    <section className="relative min-h-[70svh] lg:min-h-[78svh] flex flex-col bg-[hsl(var(--dark-section))] text-white overflow-hidden">
      {primary?.src ? (
        <div className="absolute inset-0">
          <Image
            src={primary.src}
            alt=""
            fill
            priority
            className="object-cover object-center opacity-50"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-linear-to-r from-[hsl(var(--dark-section))] via-[hsl(var(--dark-section))]/85 to-[hsl(var(--dark-section))]/40" />
          <div className="absolute inset-0 bg-linear-to-t from-[hsl(var(--dark-section))] via-transparent to-[hsl(var(--dark-section))]/30" />
        </div>
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(40_46%_56%/_0.12),transparent_55%)]"
        />
      )}

      {/* Navbar clearance only — avoid items-end/justify-center stacking a
          large empty band above the copy when the right image is tall. */}
      <div className="relative flex-1 site-container pt-30 md:pt-33 lg:pt-35 pb-10 lg:pb-14 flex flex-col justify-start lg:justify-center">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 xl:gap-16 items-center">
          <div className="lg:col-span-7 xl:col-span-6 space-y-5 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
              {storeName}
            </p>

            <h1 className="font-serif text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.12] tracking-[0.02em]">
              Everything for{" "}
              <span className="italic text-white/75">better spaces.</span>
            </h1>

            <p className="text-white/60 text-sm leading-relaxed max-w-md">
              Tiles, stone, flooring, bathrooms and roof windows from leading
              manufacturers — supplied to trade professionals and private
              clients nationwide.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 pt-1 w-full">
              <Link
                href={initialShopLink}
                className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3 sm:py-2.5 bg-white text-black uppercase tracking-[0.18em] text-[10px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors duration-300"
              >
                Explore catalogue
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/custom"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3 sm:py-2.5 border border-white/25 text-white uppercase tracking-[0.18em] text-[10px] font-bold hover:border-primary hover:text-primary transition-colors"
              >
                Bespoke enquiry
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {quickLinks.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 w-full">
                {quickLinks.slice(0, 8).map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="px-3 py-1.5 text-[9px] uppercase tracking-[0.16em] font-bold border border-white/15 text-white/70 hover:border-primary hover:text-primary transition-colors max-w-full truncate"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {secondary?.src && (
            <div className="lg:col-span-5 xl:col-span-6 hidden lg:block min-w-0">
              <Link
                href={secondary.href || "/new-arrivals"}
                className="group relative block w-full max-w-md xl:max-w-lg ml-auto aspect-3/4 overflow-hidden border border-white/10"
              >
                <Image
                  src={secondary.src}
                  alt={secondary.alt || "Featured finish"}
                  fill
                  className="object-cover transition-transform duration-[1.2s] group-hover:scale-105"
                  sizes="(max-width: 1280px) 36vw, 28vw"
                />
                <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
                <span className="absolute bottom-5 left-5 right-5 text-[10px] uppercase tracking-[0.18em] font-bold text-white/90">
                  {secondary.caption || secondary.alt}
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="relative border-t border-white/10">
        <div className="site-container py-3.5 grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-4 text-[9px] uppercase tracking-[0.16em] font-bold text-white/45">
          <span>Trade & retail</span>
          <span className="hidden md:block text-center">Showroom standard</span>
          <span className="text-right md:text-center">Nationwide delivery</span>
          <span className="col-span-2 md:col-span-1 text-center md:text-right text-primary">
            Est. 2026
          </span>
        </div>
      </div>
    </section>
  );
}

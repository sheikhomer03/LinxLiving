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
    <section className="relative min-h-[78svh] lg:min-h-[85svh] flex flex-col bg-[hsl(var(--dark-section))] text-white overflow-hidden">
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
          <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--dark-section))] via-[hsl(var(--dark-section))]/85 to-[hsl(var(--dark-section))]/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--dark-section))] via-transparent to-[hsl(var(--dark-section))]/30" />
        </div>
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(40_46%_56%/_0.12),_transparent_55%)]"
        />
      )}

      <div className="relative flex-1 max-w-[1400px] mx-auto w-full px-5 lg:px-12 xl:px-16 pt-24 md:pt-28 lg:pt-32 pb-12 flex flex-col justify-center">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-end">
          <div className="lg:col-span-7 xl:col-span-6 space-y-5">
            <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary">
              {storeName}
            </p>

            <h1 className="font-serif text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.12] tracking-[0.02em]">
              Architectural materials,{" "}
              <span className="italic text-white/75">expertly specified.</span>
            </h1>

            <p className="text-white/60 text-sm leading-relaxed max-w-md">
              Tiles, stone, flooring, bathrooms and roof windows from leading
              manufacturers — supplied to trade professionals and private
              clients nationwide.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <Link
                href={initialShopLink}
                className="group inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-white text-black uppercase tracking-[0.18em] text-[10px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors duration-300"
              >
                Explore catalogue
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/custom"
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 border border-white/25 text-white uppercase tracking-[0.18em] text-[10px] font-bold hover:border-primary hover:text-primary transition-colors"
              >
                Bespoke enquiry
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {quickLinks.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {quickLinks.slice(0, 5).map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="px-3 py-1.5 text-[9px] uppercase tracking-[0.16em] font-bold border border-white/15 text-white/70 hover:border-primary hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {secondary?.src && (
            <div className="lg:col-span-5 xl:col-span-6 hidden lg:block">
              <Link
                href={secondary.href || "/new-arrivals"}
                className="group relative block ml-auto w-full max-w-sm aspect-[3/4] overflow-hidden border border-white/10"
              >
                <Image
                  src={secondary.src}
                  alt={secondary.alt || "Featured finish"}
                  fill
                  className="object-cover transition-transform duration-[1.2s] group-hover:scale-105"
                  sizes="(max-width: 1280px) 36vw, 24vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute bottom-5 left-5 right-5 text-[10px] uppercase tracking-[0.18em] font-bold text-white/90">
                  {secondary.caption || secondary.alt}
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="relative border-t border-white/10">
        <div className="max-w-[1400px] mx-auto px-5 lg:px-12 xl:px-16 py-3.5 grid grid-cols-2 md:grid-cols-4 gap-4 text-[9px] uppercase tracking-[0.16em] font-bold text-white/45">
          <span>Trade & retail</span>
          <span className="hidden md:block">Showroom standard</span>
          <span>Nationwide delivery</span>
          <span className="text-right md:text-left text-primary">Est. 2026</span>
        </div>
      </div>
    </section>
  );
}

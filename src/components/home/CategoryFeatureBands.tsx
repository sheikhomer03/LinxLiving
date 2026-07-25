"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

export type CategoryBand = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  image: string;
  reverse?: boolean;
};

const DEFAULT_BANDS: CategoryBand[] = [
  {
    eyebrow: "Indoor & outdoor",
    title: "Surfaces",
    description:
      "Large-format stone and ceramic finishes that set the tone for bathrooms, kitchens, and living spaces.",
    href: "/new-arrivals",
    cta: "Shop surfaces",
    image: "/images/tiles2.jpg",
  },
  {
    eyebrow: "Bathroom",
    title: "Transform your space",
    description:
      "Create a striking focal point with baths, basins, and architectural detailing refined for daily ritual.",
    href: "/new-arrivals",
    cta: "Shop bathroom",
    image: "/images/tiles3.jpg",
  },
  {
    eyebrow: "Kitchen",
    title: "Seamless luxury",
    description:
      "Curate a cohesive kitchen with materials and fixtures that balance performance with quiet opulence.",
    href: "/new-arrivals",
    cta: "Shop kitchen",
    image: "/images/tiles4.jpg",
  },
];

interface CategoryFeatureBandsProps {
  bands?: CategoryBand[];
}

export function CategoryFeatureBands({
  bands = DEFAULT_BANDS,
}: CategoryFeatureBandsProps) {
  const [active, setActive] = useState(0);
  const current = bands[active] ?? bands[0];

  if (!current) return null;

  return (
    <section
      className="relative overflow-hidden bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))]"
      aria-labelledby="in-focus-heading"
    >
      {/* Atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 right-[-8%] h-[28rem] w-[28rem] rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-[-10%] h-[22rem] w-[22rem] rounded-full bg-white/[0.04] blur-3xl"
      />

      <div className="relative max-w-[1600px] mx-auto px-6 lg:px-16 xl:px-20 py-14 md:py-20">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-10 xl:gap-16 items-stretch">
          {/* Index + copy */}
          <div className="order-2 lg:order-1 lg:col-span-5 xl:col-span-4 flex flex-col justify-between gap-12 lg:min-h-[440px]">
            <div className="space-y-4">
              <p className="uppercase tracking-[0.22em] text-[10px] font-bold text-primary">
                In focus
              </p>
              <h2
                id="in-focus-heading"
                className="font-serif text-2xl md:text-3xl tracking-[0.06em] text-white"
              >
                Start with a range
              </h2>
              <p className="text-white/55 text-sm leading-relaxed max-w-sm">
                Hover a collection to preview the material story — then shop the
                full range.
              </p>
            </div>

            <nav aria-label="Featured ranges" className="space-y-0">
              {bands.map((band, index) => {
                const isActive = index === active;
                const n = String(index + 1).padStart(2, "0");

                return (
                  <div
                    key={`${band.title}-${n}`}
                    onMouseEnter={() => setActive(index)}
                    className={`group/item border-t border-white/10 py-5 md:py-6 transition-colors ${
                      isActive ? "border-primary/50" : "hover:border-white/25"
                    } ${index === bands.length - 1 ? "border-b" : ""}`}
                  >
                    <button
                      type="button"
                      onFocus={() => setActive(index)}
                      onClick={() => setActive(index)}
                      className="w-full text-left"
                      aria-current={isActive ? "true" : undefined}
                    >
                      <div className="flex items-baseline gap-4 md:gap-5">
                        <span
                          className={`text-[10px] uppercase tracking-[0.18em] font-bold shrink-0 transition-colors ${
                            isActive ? "text-primary" : "text-white/30"
                          }`}
                        >
                          {n}
                        </span>
                        <span
                          className={`font-serif text-xl md:text-2xl tracking-[0.05em] uppercase transition-colors duration-300 ${
                            isActive
                              ? "text-white"
                              : "text-white/35 group-hover/item:text-white/70"
                          }`}
                        >
                          {band.title}
                        </span>
                      </div>
                    </button>

                    <div
                      className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out ${
                        isActive
                          ? "grid-rows-[1fr] opacity-100 mt-4"
                          : "grid-rows-[0fr] opacity-0 mt-0"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <p className="text-sm text-white/55 leading-relaxed max-w-sm pl-9 md:pl-10">
                          {band.description}
                        </p>
                        <Link
                          href={band.href}
                          className="mt-5 ml-9 md:ml-10 inline-flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] font-bold text-primary hover:text-white transition-colors"
                        >
                          {band.cta}
                          <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover/item:translate-x-1" />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>

          {/* Visual stage */}
          <div className="order-1 lg:order-2 lg:col-span-7 xl:col-span-8 relative">
            <div className="relative aspect-[4/5] sm:aspect-[16/11] lg:aspect-auto lg:h-full lg:min-h-[440px] overflow-hidden bg-[hsl(var(--dark-section))]">
              {bands.map((band, index) => {
                const isActive = index === active;
                const imageSrc = band.image?.trim() || "";
                return (
                  <div
                    key={`${band.title}-${index}`}
                    className={`absolute inset-0 transition-opacity duration-700 ease-out ${
                      isActive ? "opacity-100 z-10" : "opacity-0 z-0"
                    }`}
                    aria-hidden={!isActive}
                  >
                    {imageSrc ? (
                      <Image
                        src={imageSrc}
                        alt={band.title}
                        fill
                        className={`object-contain bg-[hsl(var(--dark-section))] transition-transform duration-[1.4s] ease-out ${
                          isActive ? "scale-100" : "scale-105"
                        }`}
                        sizes="(max-width: 1024px) 100vw, 60vw"
                        priority={index === 0}
                      />
                    ) : null}
                  </div>
                );
              })}

              {/* Soft frame wash */}
              <div
                aria-hidden
                className="absolute inset-0 z-20 pointer-events-none bg-gradient-to-t from-black/45 via-transparent to-black/10"
              />

              {/* Active caption on the image — mobile clarity */}
              <div className="absolute bottom-0 inset-x-0 z-30 p-6 md:p-8 lg:hidden">
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary mb-2">
                  {current.eyebrow}
                </p>
                <p className="font-serif text-2xl tracking-[0.08em] uppercase text-white">
                  {current.title}
                </p>
              </div>

              {/* Desktop floating meta */}
              <div className="hidden lg:flex absolute bottom-8 left-8 right-8 z-30 items-end justify-between gap-6">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary mb-2">
                    {current.eyebrow}
                  </p>
                  <p className="font-serif text-xl tracking-[0.12em] uppercase text-white/90">
                    {current.title}
                  </p>
                </div>
                <Link
                  href={current.href}
                  className="group/cta shrink-0 inline-flex items-center gap-3 px-7 py-3.5 bg-white text-black uppercase tracking-[0.25em] text-[10px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors duration-500"
                >
                  {current.cta}
                  <ArrowRight className="w-3.5 h-3.5 transition-transform duration-500 group-hover/cta:translate-x-1" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

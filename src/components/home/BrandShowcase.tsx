"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { getBrandMenuTrees } from "@/app/actions/admin";
import { subscribeCatalogChange } from "@/lib/live-sync";

export type BrandShowcaseItem = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  href: string;
  menuCount: number;
};

interface BrandShowcaseProps {
  brands: BrandShowcaseItem[];
  storeName: string;
}

export function BrandShowcase({ brands, storeName }: BrandShowcaseProps) {
  const [liveBrands, setLiveBrands] = useState<BrandShowcaseItem[]>(brands);

  useEffect(() => {
    setLiveBrands(brands);
  }, [brands]);

  useEffect(() => {
    let mounted = true;

    const mapBrands = (items: any[]): BrandShowcaseItem[] =>
      items.map((brand: any) => ({
        _id: brand._id,
        name: brand.name,
        slug: brand.slug,
        image: brand.image || "",
        menuCount: brand.menus?.length || 0,
        href: brand.slug
          ? `/category?brand=${encodeURIComponent(brand.slug)}`
          : "/category",
      }));

    const refresh = async () => {
      try {
        const result = await getBrandMenuTrees();
        if (!mounted || !result.success) return;
        setLiveBrands(mapBrands(result.brands || []));
      } catch {
        // Keep last known list on fetch failures.
      }
    };

    // Only refetch when admin notifies a catalog change (props cover first paint)
    const unsubscribe = subscribeCatalogChange(() => {
      refresh();
    }, ["brands", "menus", "all"]);

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!liveBrands.length) return null;

  return (
    <section className="py-14 md:py-20 bg-background">
      <div className="site-container space-y-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-xl space-y-3">
            <p className="uppercase tracking-[0.22em] text-[10px] font-bold text-primary">
              Our brands
            </p>
            <h2 className="font-serif text-2xl md:text-3xl tracking-[0.04em] leading-tight">
              Shop by brand
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {storeName} brings together leading material houses — each with
              its own catalogue of finishes and collections.
            </p>
          </div>
          <Link
            href="/category"
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-bold border-b border-foreground/20 pb-1 hover:border-primary hover:text-primary transition-colors shrink-0"
          >
            View all products
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {liveBrands.map((brand, index) => (
            <Link
              key={brand._id}
              href={brand.href}
              className={`group relative overflow-hidden bg-secondary min-h-[220px] md:min-h-[260px] ${
                index === 0 && brands.length >= 3
                  ? "md:col-span-2 lg:col-span-1 lg:row-span-1"
                  : ""
              }`}
            >
              {brand.image ? (
                <Image
                  src={brand.image}
                  alt={brand.name}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 33vw"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-secondary to-foreground/5" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/25" />
              <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-8">
                <p className="inline-flex w-fit self-start text-[10px] uppercase tracking-[0.18em] font-bold text-primary bg-black px-2.5 py-1 mb-2">
                  {brand.menuCount > 0
                    ? `${brand.menuCount} collection${brand.menuCount === 1 ? "" : "s"}`
                    : "Brand"}
                </p>
                <h3 className="font-serif text-xl md:text-2xl tracking-[0.05em] uppercase text-white drop-shadow-sm">
                  {brand.name}
                </h3>
                <span className="mt-3 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-bold text-white/85 group-hover:text-primary transition-colors">
                  Explore range
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

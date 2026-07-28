"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type ExplorerItem = {
  name: string;
  tagline: string;
  href: string;
  image: string;
  parentName?: string;
};

interface CategoryExplorerProps {
  categories: ExplorerItem[];
  collections: ExplorerItem[];
  shopLink: string;
}

export function CategoryExplorer({
  categories: initialCategories,
  collections: initialCollections,
  shopLink,
}: CategoryExplorerProps) {
  const [tab, setTab] = useState<"categories" | "collections">("categories");
  const [categories, setCategories] = useState(initialCategories);
  const [collections, setCollections] = useState(initialCollections);

  useEffect(() => {
    setCategories(initialCategories);
    setCollections(initialCollections);
  }, [initialCategories, initialCollections]);

  const items = tab === "categories" ? categories : collections;

  if (!categories.length && !collections.length) return null;

  return (
    <section className="bg-secondary/30 px-6 lg:px-20 py-14 md:py-20" id="shop">
      <div className="max-w-[1600px] mx-auto space-y-10">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <div className="space-y-4 max-w-2xl">
            <p className="uppercase tracking-[0.22em] text-[10px] font-bold text-primary">
              Catalogue
            </p>
            <h2 className="font-serif text-2xl md:text-3xl tracking-[0.04em]">
              Find your finish
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Browse by category or explore curated product collections built
              in the admin dashboard.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-background border border-foreground/10 shrink-0">
            <button
              type="button"
              onClick={() => setTab("categories")}
              className={cn(
                "px-6 py-3 text-[10px] uppercase tracking-[0.25em] font-bold transition-colors",
                tab === "categories"
                  ? "bg-foreground text-background"
                  : "text-foreground/50 hover:text-foreground",
              )}
            >
              Categories
            </button>
            <button
              type="button"
              onClick={() => setTab("collections")}
              className={cn(
                "px-6 py-3 text-[10px] uppercase tracking-[0.25em] font-bold transition-colors",
                tab === "collections"
                  ? "bg-foreground text-background"
                  : "text-foreground/50 hover:text-foreground",
              )}
            >
              Collections
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {items.slice(0, 8).map((item) => (
            <Link
              key={`${item.href}-${item.name}`}
              href={item.href}
              className="group relative aspect-[3/4] overflow-hidden bg-secondary"
            >
              {item.image ? (
                <Image
                  src={item.image}
                  alt={item.name}
                  fill
                  className="object-contain p-3 transition-transform duration-700 group-hover:scale-[1.04]"
                  sizes="(max-width: 1024px) 50vw, 25vw"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
              {item.parentName && (
                <span className="absolute top-3 left-3 px-2 py-1 bg-white/95 text-[8px] uppercase tracking-[0.18em] font-bold">
                  {item.parentName}
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
                <h3 className="font-serif text-sm md:text-lg tracking-[0.1em] uppercase text-white">
                  {item.name}
                </h3>
                <p className="hidden md:block text-[10px] text-white/60 mt-1 tracking-wide">
                  {item.tagline}
                </p>
              </div>
            </Link>
          ))}
        </div>

        <div className="flex justify-center pt-4">
          <Link
            href={tab === "collections" ? "/category" : shopLink}
            className="inline-flex items-center gap-3 px-6 py-2.5 border border-foreground/15 text-[10px] uppercase tracking-[0.18em] font-bold hover:border-primary hover:text-primary transition-colors"
          >
            {tab === "collections" ? "View all products" : "View full catalogue"}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";

/**
 * The "Discover" card at the foot of the bag, as Lusso Stone carries it:
 * one photograph, an eyebrow, and the collection it opens.
 *
 * Lusso's card is fixed. Ours rotates — a different department each time the
 * bag is opened — because a single hard-coded tile is a dead end for anyone
 * whose basket is already in that department, and this catalogue spans nine
 * departments rather than one bathroom range.
 *
 * Hand-picked rather than derived from the basket: this is the way out of an
 * empty bag and the browse prompt under a full one, so it has to render before
 * any data arrives. `CartRecommendations` remains the basket-aware upsell above
 * it; the two answer different questions ("more like this" vs "somewhere else
 * to go"). The stills are the staged interiors already in /public — a cover
 * derived from the catalogue is as often as not a cut-out on white, which is
 * the wrong subject behind a caption.
 */
const DISCOVER = [
  {
    eyebrow: "Bathrooms",
    label: "Baths & Sanitaryware",
    href: "/category?department=bathrooms",
    image: "/home/hero/bathroom-tiles.png",
  },
  {
    eyebrow: "Surfaces",
    label: "Wall & Floor Tiles",
    href: "/category?department=tiles",
    image: "/home/hero/kitchen-tiles.png",
  },
  {
    eyebrow: "Flooring",
    label: "Wood & Vinyl",
    href: "/category?department=flooring",
    image: "/home/hero/wood-flooring.png",
  },
  {
    eyebrow: "Heating",
    label: "Underfloor Heating",
    href: "/category?department=heating",
    image: "/home/hero/heated-bathroom.png",
  },
  {
    eyebrow: "Wall Panels",
    label: "Panelling & Splashbacks",
    href: "/category?department=wall-panels",
    image: "/images/tiles5.jpg",
  },
] as const;

/** A different card from the one just shown, so two opens never repeat. */
function rollFrom(previous: number) {
  if (DISCOVER.length < 2) return 0;
  const offset = 1 + Math.floor(Math.random() * (DISCOVER.length - 1));
  return (previous + offset) % DISCOVER.length;
}

export function CartDiscover({ className }: { className?: string }) {
  const close = useCartDrawerStore((s) => s.close);
  const isOpen = useCartDrawerStore((s) => s.isOpen);

  /*
   * Seeded during render, not in an effect: an effect-set index shows card 0
   * for a frame and then swaps it under the shopper. Safe to randomise here
   * because CartDrawer returns null until it has mounted, so this never renders
   * on the server and there is no hydration to mismatch.
   */
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * DISCOVER.length),
  );

  // Re-roll on the closed → open edge only. Without the edge check every
  // unrelated re-render of the open drawer would change the card mid-read.
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) setIndex(rollFrom);
    wasOpen.current = isOpen;
  }, [isOpen]);

  const tile = DISCOVER[index];

  return (
    <section className={className}>
      <h3 className="px-5 pt-6 pb-3 text-[10px] uppercase tracking-[0.28em] font-bold text-foreground">
        Discover
      </h3>
      {/* Inset on the same 20px gutter as the header, the line items and the
          totals, rather than bleeding to the drawer edge — full-bleed left the
          photograph starting a gutter to the left of every other thing in the
          panel, which read as a misalignment rather than as a deliberate edge. */}
      <div className="px-5 pb-1">
        <Link
          href={tile.href}
          onClick={close}
          className="group block border border-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/30"
        >
          <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
            <Image
              // Keyed so the crossfade restarts on a re-roll rather than the new
              // photograph simply appearing in the old one's place.
              key={tile.image}
              src={tile.image}
              alt={tile.label}
              fill
              sizes="(max-width: 640px) 100vw, 408px"
              className="object-cover transition-transform duration-700 group-hover:scale-105"
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                {tile.eyebrow}
              </p>
              <p className="mt-1.5 text-[11px] sm:text-xs uppercase tracking-[0.12em] font-bold leading-snug">
                {tile.label}
              </p>
            </div>
            <ArrowRight
              aria-hidden
              className="w-4 h-4 shrink-0 stroke-[1.5] text-foreground/50 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-foreground"
            />
          </div>
        </Link>
      </div>
    </section>
  );
}

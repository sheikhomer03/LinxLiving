"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Footer } from "@/components/layout/Footer";

/**
 * The catalogue landing page, built to Lusso Stone's /collections index.
 *
 * Theirs is a directory rather than a product listing: a full-bleed banner
 * with one centred word over it, then a flat A–Z grid of collection cards —
 * square photograph, uppercase name, arrow — twelve at a time behind a
 * "Load More" button. No filters, no prices, no sort.
 *
 * Every measurement below was read off the live page at 1440 and 390:
 *   grid      4 x 326px, 24px column gap, 48px row gap (2 x 171px / 16px)
 *   gutters   32px desktop, 16px mobile
 *   media     square, object-fit: cover
 *   name      10px / 9px, weight 500, tracking 1.4px, uppercase, 14px line
 *   banner    720px tall desktop, 654px mobile; heading 24px / 18px white
 *   button    black, white, 12px uppercase, 12px 24px padding
 */

export type CatalogueIndexItem = {
  /** Category slug — unique within the list, and the React key. */
  slug: string;
  name: string;
  image: string;
  href: string;
};

/** Lusso reveals twelve at a time — three desktop rows. */
const PAGE_SIZE = 12;

export function CatalogueIndex({
  items,
  heading,
  bannerImage,
  storeName,
}: {
  items: CatalogueIndexItem[];
  heading: string;
  bannerImage: string;
  /** Seeds the footer, same as every other storefront page. */
  storeName?: string;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = items.slice(0, shown);
  const hasMore = shown < items.length;

  return (
    <main className="min-h-screen bg-background">
      {/* Banner. One photograph, one centred word — the reference carries no
          sub-copy or button here.

          No `page-top`: the header runs transparent over this banner (see
          CategoryNavbar), so the image starts at the top of the window and
          the header sits on it rather than above it. */}
      <section className="relative w-full">
        <div className="relative h-[654px] w-full lg:h-[720px]">
          <Image
            src={bannerImage}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          {/* The reference sets its heading in plain white and relies on a
              dark photograph behind it. Ours are bright interiors, so a soft
              scrim keeps the word legible whichever image is used — the same
              trick the overlay header uses. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.42),transparent_62%)]"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <h1 className="font-menu px-6 text-center text-[18px] font-medium uppercase tracking-[1px] text-white lg:text-[24px]">
              {heading}
            </h1>
          </div>
        </div>
      </section>

      <section className="px-4 py-12 lg:px-8 lg:py-16">
        <ul
          role="list"
          className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-12"
        >
          {visible.map((item) => (
            <li key={item.slug}>
              {/* `group` drives the arrow nudge — the reference slides its
                  arrow right on hover (its `animate-arrow` class). */}
              <Link href={item.href} className="group block">
                <span className="relative block aspect-square w-full overflow-hidden bg-secondary/40">
                  <Image
                    src={item.image}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 25vw, 50vw"
                    className="object-cover"
                  />
                </span>
                {/* The arrow is inline, not a flex sibling: a two-line name
                    like "Adhesives & Levellers" pushed a flex arrow out to
                    the far right of the card on its own. Inline keeps it
                    tucked against the last word wherever that falls. */}
                <span className="font-menu mt-4 block text-[9px] font-medium uppercase leading-[12.6px] tracking-[1.4px] text-black lg:text-[10px] lg:leading-[14px]">
                  {item.name}
                  <ArrowRight className="ml-2 inline-block h-3 w-3 shrink-0 align-middle opacity-100 transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {items.length > 0 ? (
          <div className="mt-12 flex flex-col items-center gap-6">
            <p className="text-[14px] text-foreground">
              Showing {visible.length} of {items.length}
            </p>
            {hasMore ? (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
                className="font-menu bg-black px-6 py-3 text-[12px] uppercase text-white"
              >
                Load More
              </button>
            ) : null}
          </div>
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No categories to show yet.
          </p>
        )}
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}

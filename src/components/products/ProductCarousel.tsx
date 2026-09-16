"use client";

import { useRef } from "react";
import { ProductCard } from "@/components/products/ProductCard";
import { cn } from "@/lib/utils";
import { SliderChevron } from "@/components/products/ProductDisclosure";

/**
 * The product strip a Lusso product page repeats under its accordions.
 *
 * Four of them run there — FREQUENTLY BOUGHT TOGETHER, YOU MAY ALSO LIKE,
 * COMPLETE THE LOOK, RECENTLY VIEWED — all the same shape. Measured off
 * /products/romano-fluted-travertine-stone-mosaic-wall-tile:
 *
 *   track    the left half of the content column, starting at x=128 —
 *            592px wide at 1440 and 832px at 1920, i.e. half of the
 *            1184/1664 page width. It is not full-bleed: the strip lines up
 *            with the accordion under it, and scrolls within that column.
 *   card     four to a view — (track - 3 x 24) / 4, so 130px at 1440 and
 *            190px at 1920 — on a square photograph
 *   gutter   24px
 *   heading  14px / 1.4px tracking, uppercase, at the track's left edge
 *   arrows   at the track's right edge (x=652 at 1440)
 *   title    10px / 1.4px tracking, left
 *   price    10px
 *
 * The cards are `ProductCard` in its collection layout rather than a second
 * card written here: at 130px it already renders a square photograph, a
 * 10px uppercase title and the price, and it brings the pricing rules —
 * trade, sale, VAT, per-m² — with it. Writing a second card would mean
 * re-deriving all of that and getting it subtly wrong.
 */

export type CarouselProduct = {
  _id: string;
  name: string;
  price: number;
  images?: string[] | null;
  shopifyImages?: unknown;
  category?: string;
  department?: string;
  stock?: number;
  shopifyVariantId?: string | null;
  vatRate?: number | null;
  specs?: Record<string, unknown> | null;
  brandName?: string;
  brandSlug?: string;
  /** Free-sample eligibility, resolved on the server. */
  hasPaidSample?: boolean;
};

export function ProductCarousel({
  title,
  products,
  inColumn = false,
}: {
  title: string;
  products: CarouselProduct[];
  /**
   * Rendered inside the product's left column rather than at page level.
   *
   * The column already provides the 128px inset and is already half the
   * content width, so the strip takes neither again — it just fills what it
   * is given. Set for the first strip, which sits beside the buy card; the
   * ones further down the page are full-width sections and take the
   * defaults.
   */
  inColumn?: boolean;
}) {
  const track = useRef<HTMLUListElement>(null);

  // A strip with nothing in it is not an empty strip — the reference simply
  // does not print the heading. Its own second recommendations section is
  // configured and renders nothing for exactly this reason.
  if (!products.length) return null;

  const scrollBy = (direction: 1 | -1) => {
    // One view — the four cards on screen — so the arrows turn the page the
    // way the reference's do, at whatever width the column happens to be.
    const width = track.current?.clientWidth ?? 0;
    track.current?.scrollBy({ left: direction * width, behavior: "smooth" });
  };

  return (
    <section className="pb-16">
      {/*
        Heading left, arrows right — inside a 592px row, not the full
        container. The reference's `.carousel__header` is `page-width` inside
        a half-width wrapper, which at 1440 puts its arrows at x=652 rather
        than out at the right margin; that is where they read on the page, so
        that is where they go. The row collapses to the container width below
        that, where 592px no longer fits.

          button  32x32, 50% radius, 1px rgba(0,0,0,.2), transparent
          icon    16x16 chevron, square caps
          gap     4px between the pair
      */}
      <div className={cn("px-4", inColumn ? "min-[990px]:px-0" : "min-[990px]:px-32")}>
        <div className={cn("flex items-center justify-between gap-4", !inColumn && "min-[990px]:w-1/2")}>
          <h2 className="font-menu text-[14px] font-medium uppercase leading-[16.8px] tracking-[1.4px] text-black">
            {title}
          </h2>

          {/* Only worth drawing when there is something to scroll to — eight
              cards fit the container at 1440 and the arrows would do nothing. */}
          {products.length > 4 ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => scrollBy(-1)}
                aria-label={`Scroll ${title} backwards`}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-black/20 bg-transparent text-black transition-colors hover:border-black/60"
              >
                <SliderChevron direction="left" />
              </button>
              <button
                type="button"
                onClick={() => scrollBy(1)}
                aria-label={`Scroll ${title} forwards`}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-black/20 bg-transparent text-black transition-colors hover:border-black/60"
              >
                <SliderChevron direction="right" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/*
        The track keeps the container's left inset but runs to the right edge
        of the window, so the row reads as continuing past the screen the way
        the reference's does. Scrollbar hidden; the arrows and a swipe drive
        it.
      */}
      <div className={cn("px-4", inColumn ? "min-[990px]:px-0" : "min-[990px]:px-32")}>
        <ul
          ref={track}
          role="list"
          className={cn(
            "mt-6 flex gap-6 overflow-x-auto scroll-smooth [-ms-overflow-style:none] scrollbar-none [&::-webkit-scrollbar]:hidden",
            !inColumn && "min-[990px]:w-1/2",
          )}
        >
          {products.map((product) => (
            /* Four to a view: three 24px gutters come out of the track
               before the remainder is split. Two up on a phone. */
            <li
              key={product._id}
              className="w-[calc((100%-24px)/2)] shrink-0 min-[750px]:w-[calc((100%-72px)/4)]"
            >
            <ProductCard
              /* Four to a 1440px row is 130px a card, two-up on a phone is
                 about 190. Asking the CDN for a 430px card here downloaded a
                 95 KB file to fill a 130px square, eighty times over. */
              renderWidth={200}
              id={product._id}
              name={product.name}
              price={product.price}
              images={product.images}
              shopifyImages={product.shopifyImages as never}
              category={product.category || ""}
              department={product.department}
              brandName={product.brandName}
              brandSlug={product.brandSlug}
              priceMode={
                (product.specs?.priceDisplay as string | undefined) || undefined
              }
              pricePerM2={
                Number(product.specs?.pricePerM2) > 0
                  ? Number(product.specs?.pricePerM2)
                  : null
              }
              size={(product.specs?.size as string | undefined) || undefined}
              hasPaidSample={product.hasPaidSample}
              salePercent={
                typeof product.specs?.salePercent === "number"
                  ? (product.specs.salePercent as number)
                  : null
              }
              vatRate={product.vatRate == null ? 20 : Number(product.vatRate)}
              stock={product.stock}
              shopifyVariantId={product.shopifyVariantId}
                layout="minimal"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

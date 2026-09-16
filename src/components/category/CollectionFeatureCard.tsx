import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CollectionFeature } from "@/lib/collectionSections";

/**
 * A promo card laid inside the product grid, in place of product cells.
 *
 * Measured off /collections/tiles at 1440, where the grid runs four 326px
 * columns on a 24px gutter and each product cell is 450px tall:
 *
 *   half card  676 × 450 — two columns, one row, so 3:2
 *   wide card  1376 × 688 — the whole row, so 2:1
 *   mobile     a square photograph (the reference swaps to a 749² crop)
 *   content    absolute, centred, bottom-aligned; 16px padding, 32px ≥750
 *   title      18px / 500 / 1.4px tracking, uppercase, white
 *   copy       10px / 500 / 1.4px tracking, uppercase, white, max 440px
 *   button     40px tall, 24px side padding, 12px / 0.6px, black on white
 *
 * The reference's photographs are dark enough to carry white type on their
 * own; ours are showroom shots that are not, so the one addition is a scrim
 * under the content. Without it the title disappears into a pale ceiling.
 */
export function CollectionFeatureCard({
  feature,
}: {
  feature: CollectionFeature;
}) {
  const wide = feature.span === 4;

  return (
    <div
      className={cn(
        "group relative col-span-2 overflow-hidden bg-secondary/40",
        wide
          ? "min-[750px]:col-span-3 min-[1200px]:col-span-4"
          : "min-[750px]:col-span-2",
        "aspect-square",
        wide ? "min-[750px]:aspect-2/1" : "min-[750px]:aspect-3/2",
      )}
    >
      <Image
        src={feature.image}
        alt=""
        fill
        sizes={
          wide
            ? "(min-width: 750px) 100vw, 100vw"
            : "(min-width: 1200px) 50vw, (min-width: 750px) 67vw, 100vw"
        }
        className="object-cover transition-transform duration-500 group-hover:scale-105"
      />

      {/* Legibility only — see the note above. */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-black/60 via-black/25 to-transparent"
      />

      <div className="absolute inset-0 flex flex-col items-center justify-end p-4 text-center min-[750px]:p-8">
        <h3 className="font-menu text-[18px] font-medium uppercase leading-[21.6px] tracking-[1.4px] text-white">
          {feature.title}
        </h3>
        <p className="mt-4 max-w-[440px] text-[10px] font-medium uppercase leading-[14px] tracking-[1.4px] text-white">
          {feature.description}
        </p>
        <Link
          href={feature.href}
          className="font-menu mt-6 inline-flex h-10 w-fit items-center justify-center bg-white px-6 text-[12px] font-medium uppercase leading-[16.8px] tracking-[0.6px] text-black transition-opacity hover:opacity-85"
        >
          {feature.ctaLabel}
        </Link>
      </div>
    </div>
  );
}

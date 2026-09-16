import Image from "next/image";
import Link from "next/link";
import { DEFAULT_SUPPORT_PHONE } from "@/lib/company";
import { guidesForDepartment } from "@/lib/collectionGuides";

/**
 * The three-up row of editorial cards below a collection's product grid.
 *
 * The theme's "usp grid", measured off /collections/bathroom at 1440, where
 * each card is 442px wide on a 24px gutter:
 *
 *   cards     1 up, 3 up from 750px; 24px gutters between
 *   image     4:5 portrait, object-fit: cover, scales to 1.1 on hover
 *   gap       16px image → title, 8px title → cta
 *   title     14px, tracking 1.4px, uppercase, left-aligned
 *   cta       READ MORE, 12px, tracking 0.6px
 *
 * /collections/heating leaves the row unfilled, so it is content-driven
 * rather than page-shaped; every department here gets a set from
 * `collectionGuides`. What follows it — an editorial paragraph, the sales
 * line, an FAQ — varies by department (see `collectionSections`).
 */
export function CollectionGuides({
  departmentSlug,
  fallbackImages = [],
}: {
  /** Picks the department's card set; falls back to the shared three. */
  departmentSlug?: string | null;
  /**
   * Photographs off products in the department being browsed, in grid order.
   *
   * A card whose `image` is left out takes the next one of these — see the
   * note on `CollectionGuide.image`. They arrive with the grid, so the first
   * paint can have none; a card with nothing to show renders its tint rather
   * than a broken tile, and fills in when the products land.
   */
  fallbackImages?: string[];
}) {
  const guides = guidesForDepartment(departmentSlug);

  // No cards configured — no section, not an empty one. /collections/heating
  // closes straight onto its sales line, and a bare <ul> would leave 64px of
  // padding sitting where the row used to be.
  if (!guides.length) return null;

  // Walked rather than indexed by card, so three cards needing a photograph
  // take three different ones instead of all landing on fallbackImages[2].
  let nextFallback = 0;

  return (
    <section className="px-4 pb-16 min-[990px]:px-8">
      <ul role="list" className="grid grid-cols-1 gap-6 min-[750px]:grid-cols-3">
        {guides.map((guide) => {
          const image = guide.image || fallbackImages[nextFallback++] || "";
          return (
          <li key={guide.href + guide.title}>
            <Link href={guide.href} className="group block no-underline">
              <span className="relative block aspect-4/5 w-full overflow-hidden bg-secondary/40">
                {image ? (
                  <Image
                    src={image}
                    alt=""
                    fill
                    sizes="(min-width: 750px) 33vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                ) : null}
              </span>
              <span className="font-menu mt-4 block text-[14px] font-medium uppercase leading-[17px] tracking-[1.4px] text-black">
                {guide.title}
              </span>
              <span className="font-menu mt-2 block max-w-[320px] text-[12px] font-medium uppercase leading-[17px] tracking-[0.6px] text-black">
                Read more
              </span>
            </Link>
          </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The centred "call sales" line, the last thing above the footer.
 *
 * Its own component because the reference does not always put it directly
 * under the guide cards — /collections/tiles slots an editorial paragraph
 * between the two, and the FAQ accordion below it.
 */
export function CollectionSalesLine() {
  const tel = DEFAULT_SUPPORT_PHONE.replace(/\s/g, "");

  return (
    <section className="px-4 pb-16 text-center min-[990px]:px-8">
      <p className="text-[14px] font-bold uppercase text-black">Call sales on</p>
      <a
        href={`tel:${tel}`}
        className="text-[14px] font-bold text-black underline underline-offset-4"
      >
        {DEFAULT_SUPPORT_PHONE}
      </a>
    </section>
  );
}

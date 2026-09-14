import Image from "next/image";
import Link from "next/link";
import { DEFAULT_SUPPORT_PHONE } from "@/lib/company";
import { guidesForDepartment } from "@/lib/collectionGuides";

/**
 * What a Lusso collection page puts below its product grid.
 *
 * Two things, in this order, measured off /collections/bathroom at 1440:
 * a three-up row of editorial cards (the theme's "usp grid"), then a small
 * centred "call sales" line. The four rich-text sections between them are
 * configured but empty and render nothing.
 *
 * /collections/heating carries the sales line alone — its card row is
 * simply unfilled — so the row is content-driven rather than page-shaped,
 * and every department here gets one from `collectionGuides`.
 *
 *   cards     1 up, 3 up from 750px; 24px gutters between
 *   image     4:5 portrait, object-fit: cover, scales to 1.1 on hover
 *   gap       16px image → title, 8px title → cta
 *   title     14px, tracking 1.4px, uppercase, left-aligned
 *   cta       READ MORE, 12px, tracking 0.6px
 *   sales     "CALL SALES ON" over an underlined tel link, centred
 */
export function CollectionGuides({
  departmentSlug,
}: {
  /** Picks the department's card set; falls back to the shared three. */
  departmentSlug?: string | null;
}) {
  const guides = guidesForDepartment(departmentSlug);
  const tel = DEFAULT_SUPPORT_PHONE.replace(/\s/g, "");

  return (
    <>
      <section className="px-4 pb-16 lg:px-8">
        <ul role="list" className="grid grid-cols-1 gap-6 min-[750px]:grid-cols-3">
          {guides.map((guide) => (
            <li key={guide.href + guide.title}>
              <Link href={guide.href} className="group block no-underline">
                <span className="relative block aspect-4/5 w-full overflow-hidden bg-secondary/40">
                  <Image
                    src={guide.image}
                    alt=""
                    fill
                    sizes="(min-width: 750px) 33vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                </span>
                <span className="font-menu mt-4 block text-[14px] font-medium uppercase leading-[17px] tracking-[1.4px] text-black">
                  {guide.title}
                </span>
                <span className="font-menu mt-2 block max-w-[320px] text-[12px] font-medium uppercase leading-[17px] tracking-[0.6px] text-black">
                  Read more
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 pb-16 text-center lg:px-8">
        <p className="text-[14px] font-bold uppercase text-black">
          Call sales on
        </p>
        <a
          href={`tel:${tel}`}
          className="text-[14px] font-bold text-black underline underline-offset-4"
        >
          {DEFAULT_SUPPORT_PHONE}
        </a>
      </section>
    </>
  );
}

import type { CollectionCopy as CollectionCopyContent } from "@/lib/collectionSections";

/**
 * The centred editorial block between the guide cards and the sales line.
 *
 * The reference's "rich text" section, measured on /collections/tiles at
 * 1440: a 900px column centred in the page, a 32px gap under the heading,
 * and everything centre-aligned.
 *
 *   heading  24px / 500 / 1.92px tracking, uppercase, 28.8px line
 *   body     14px on a 19.6px line, 0.35px tracking
 */
export function CollectionCopy({ copy }: { copy: CollectionCopyContent }) {
  return (
    <section className="px-4 pb-16 min-[990px]:px-8">
      <div className="mx-auto flex max-w-[900px] flex-col gap-8 text-center">
        <h2 className="font-menu text-[24px] font-medium uppercase leading-[28.8px] tracking-[1.92px] text-black">
          {copy.heading}
        </h2>
        <div className="space-y-4">
          {copy.body.map((paragraph, i) => (
            <p
              key={i}
              className="text-[14px] leading-[19.6px] tracking-[0.35px] text-black"
            >
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

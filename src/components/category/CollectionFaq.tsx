"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollectionFaq as CollectionFaqItem } from "@/lib/collectionSections";

/**
 * The accordion a Lusso collection page closes on.
 *
 * Measured off /collections/tiles at 1440 — an 800px section with 32px side
 * padding, so a 736px column of questions centred under a centred heading:
 *
 *   column    736px, flex column, 24px between heading and list
 *   heading   18px / 500 / 1.2px tracking, uppercase, centred
 *   item      1px rgba(0,0,0,.1) rule above, no rule below the last
 *   header    16px vertical padding, 56px tall
 *   question  14px / 500 / 1.2px tracking, uppercase, left
 *   icon      24px box holding a 12px plus, swapped for a minus when open
 *   answer    14px on a 19.6px line, 0.35px tracking
 *
 * One open at a time (the reference sets `data-auto-close`), and the first
 * question opens on load (`data-open-first`).
 */
export function CollectionFaq({
  items,
  heading = "Frequently asked questions",
}: {
  items: CollectionFaqItem[];
  heading?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (!items.length) return null;

  return (
    <section className="px-4 pb-16 min-[990px]:px-8">
      {/* Full width until 990, then the reference's 800px section minus its
          32px gutters. Capping it earlier would leave a narrow column of
          questions stranded in the middle of a tablet screen. */}
      <div className="mx-auto flex flex-col gap-6 min-[990px]:max-w-[736px]">
        <h2 className="font-menu text-center text-[18px] font-medium uppercase leading-[21.6px] tracking-[1.2px] text-black">
          {heading}
        </h2>

        <div>
          {items.map((item, index) => {
            const open = openIndex === index;
            return (
              <div key={item.question} className="border-t border-black/10">
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(open ? null : index)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 py-4 text-left"
                  >
                    <span className="font-menu text-[14px] font-medium uppercase leading-[19.6px] tracking-[1.2px] text-black">
                      {item.question}
                    </span>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center text-black">
                      {open ? (
                        <Minus className="h-3 w-3" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                    </span>
                  </button>
                </h3>

                {/* Grid-rows transition rather than a measured height — the
                    answers vary in length and none of them needs a ref. */}
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-300 ease-out",
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="pt-2 pb-3 text-[14px] leading-[19.6px] tracking-[0.35px] text-black">
                      {item.answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

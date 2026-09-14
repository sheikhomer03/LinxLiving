"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The black block a Lusso Stone collection page opens on.
 *
 * Measured off /collections/baths at 1440: a full-bleed black panel the
 * transparent header sits on, carrying a 10px uppercase eyebrow, a 24px
 * uppercase heading and centred 14px copy that is clamped until "Read More"
 * is pressed. Nothing else — no breadcrumb, no count, no buttons.
 *
 *   eyebrow   10px, tracking 1.2px, uppercase, white
 *   heading   24px, weight 500, tracking 1.2px, uppercase, white
 *   copy      14px on a 19.6px line, white, centred, clamped to 4 lines
 *   Read More 14px, white, underlined
 */
export function CollectionHero({
  eyebrow = "All",
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="w-full bg-black">
      {/*
        `page-top` clears the transparent header; the extra `pt-16` is the
        gap the reference leaves between the header and its eyebrow, which
        puts the heading around 170px down the block.
      */}
      {/*
        `page-top` on the outer element and the padding on the inner one:
        `.page-top` is an unlayered rule, so it outranks a Tailwind `pt-*`
        utility on the same element and the extra space would be dropped.
      */}
      <div className="page-top">
        <div className="mx-auto max-w-[64rem] px-8 pb-8 pt-10 text-center min-[990px]:pt-[90px]">
        {eyebrow ? (
          <p className="font-menu text-[10px] uppercase leading-[14px] tracking-[1.2px] text-white">
            {eyebrow}
          </p>
        ) : null}

        <h1 className="font-menu mt-2 text-[24px] font-medium uppercase leading-[29px] tracking-[1.2px] text-white">
          {title}
        </h1>

        {description ? (
          <div className="mx-auto mt-8 max-w-[31.5rem] px-8">
            <p
              className={cn(
                "text-[14px] leading-[19.6px] tracking-[1px] text-white",
                !expanded && "line-clamp-4",
              )}
            >
              {description}
            </p>
            {/* Only offered when there is enough copy to be worth hiding —
                a two-line description with a Read More under it is noise. */}
            {description.length > 240 ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 text-[14px] font-bold text-white underline underline-offset-4"
              >
                {expanded ? "Read Less" : "Read More"}
              </button>
            ) : null}
          </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

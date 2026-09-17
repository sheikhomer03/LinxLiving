import { cn } from "@/lib/utils";

/**
 * The one dropdown mark the product page uses.
 *
 * Measured off /products/romano-fluted-travertine-stone-mosaic-wall-tile:
 * the reference draws a 24px plus that becomes a minus when the row opens —
 * `stroke-width: 1.5`, square caps — never a rotating chevron. Its rows
 * carry both SVGs and cross-fade the opacity; one element swapping its path
 * is the same picture with less markup.
 *
 * Every disclosure on the page imports this so they cannot drift apart:
 * the accordion rows, the supplier sections, the download lists and the
 * documentation panels were each drawing their own 16px chevron.
 */
export function DisclosureIcon({
  open,
  className,
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("h-6 w-6 shrink-0", className)}
    >
      <path
        d={
          open
            ? "M6.75 12H17.25"
            : "M12 6.75V12M12 12V17.25M12 12H6.75M12 12H17.25"
        }
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  );
}

/**
 * The row the mark sits in, so every dropdown opens on the same line.
 *
 *   rule    1px rgba(0,0,0,.1) above the row, nothing below the last
 *   header  40px tall — 8px of padding top and bottom
 *   title   12px / 500 / 1.4px tracking, uppercase, left
 */
export const DISCLOSURE_ROW_CLASS = "border-t border-black/10";

export const DISCLOSURE_HEADER_CLASS =
  "flex w-full items-center justify-between gap-4 py-2 text-left";

export const DISCLOSURE_TITLE_CLASS =
  "font-menu text-[12px] font-medium uppercase leading-[1.2] tracking-[1.4px] text-black";

/**
 * The same mark for a `<details>` row, where there is no React state to read.
 *
 * Both paths are rendered and CSS picks one, which is exactly what the
 * reference does — it ships a minus and a plus in every row and swaps their
 * opacity on `[open]`. Needs `class="group"` on the `<details>`.
 */
export function DisclosureIconDetails({ className }: { className?: string }) {
  return (
    <span className={cn("relative block h-6 w-6 shrink-0", className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="absolute inset-0 h-6 w-6 group-open:hidden"
      >
        <path
          d="M12 6.75V12M12 12V17.25M12 12H6.75M12 12H17.25"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="square"
        />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="absolute inset-0 hidden h-6 w-6 group-open:block"
      >
        <path
          d="M6.75 12H17.25"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="square"
        />
      </svg>
    </span>
  );
}

/**
 * The chevron the reference puts inside its round slider buttons.
 *
 * 16x16 on a 16-unit viewBox with `stroke-linecap: square` — a sharper mark
 * than lucide's rounded caps, and the difference shows at this size.
 * (component-slider.css, .slider-button .icon)
 */
export function SliderChevron({
  direction,
  strokeWidth = 1,
}: {
  direction: "left" | "right";
  /** Defaults to the reference's hairline weight; pass 2+ for a bolder mark. */
  strokeWidth?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d={
          direction === "left"
            ? "M9.99984 13.3333L4.6665 8L9.99984 2.66666"
            : "M6 2.66666L11.3333 7.99998L6 13.3333"
        }
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="square"
      />
    </svg>
  );
}

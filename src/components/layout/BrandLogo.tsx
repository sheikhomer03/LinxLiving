import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  /** Light text for dark backgrounds (e.g. footer) */
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg" | "header";
  /** Kept for callers / accessibility */
  name?: string;
}

/**
 * Fixed width, height locked to the viewBox via aspect-ratio (rather than a
 * separate fixed height) so that when the header icon cluster leaves less
 * room than the target width and `max-w-full` shrinks it, the height scales
 * down with it instead of staying fixed and squashing the mark.
 *
 * Every width here was divided by 1.2255 when the viewBox was trimmed from
 * 920 to 750.7 (see the note on the `svg` below) — the same ratio the box
 * itself lost. The mark therefore renders at exactly the height it always
 * did; only the empty space to its right is gone.
 */
const sizeClasses = {
  sm: "w-[6.69rem] sm:w-[8.04rem] lg:w-[9.38rem]",
  // `md` gained a large-screen step so the header mark keeps growing past the
  // sm breakpoint: at 14.28rem the mark stands 43px tall, which fills the
  // (now 64px) header bar rather than sitting in the middle of it.
  md: "w-[9.38rem] sm:w-[12.08rem] lg:w-[14.28rem]",
  lg: "w-[12.08rem] sm:w-[16.07rem]",
  /*
   * The Lusso-layout header mark.
   *
   * That header stands its logo 16px tall on mobile and 20px on desktop, and
   * the wordmark sits centred in a two-column slot rather than filling a bar,
   * so it has to be set by height, not width. The trimmed box is 5.36:1,
   * which puts 17px at 8.98rem and 21px at 11.42rem — the closest this mark
   * gets to the reference without the much longer "LINX SQUARE" wordmark
   * overrunning the columns either side of it.
   */
  header: "w-[8.98rem] lg:w-[11.42rem]",
};

function LinxSquareMark({
  className,
  title,
}: {
  className?: string;
  title: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      /*
       * 750.7 wide, not 920.
       *
       * The box used to run to 920 while the ink stopped at 744.7 — measured
       * with `getBBox()` in the browser with Tenor Sans loaded, consistent at
       * every width. With `xMinYMid` pinning the drawing left, that left 175
       * units of dead space on the right and put the visible centre of the
       * mark at 40.8% of the box instead of 50%. Anywhere the logo was
       * centred it therefore sat visibly left — 16px off at header size — and
       * anywhere it was right-aligned it floated away from its edge.
       *
       * Trimmed to the ink plus a 6-unit gutter either side (the same gutter
       * the square already had on the left), so the box now centres on what
       * you can actually see. The widths above were rescaled to match, which
       * keeps every existing placement at the height it had.
       */
      viewBox="0 0 750.7 140"
      role="img"
      aria-label={title}
      // opacity-100 opts out of the global `svg { opacity: .7 }` icon rule in
      // globals.css, which was fading the brand mark to grey — black ink at
      // 70% over white is #4c4c4c, which is what the logo was rendering as.
      className={cn(
        "block max-w-full h-auto aspect-[750.7/140] opacity-100",
        className,
      )}
      preserveAspectRatio="xMinYMid meet"
    >
      <title>{title}</title>
      {/* The square carries the brand gold rather than the wordmark's ink, so
          it matches the service-strip icons above the hero (both resolve to
          --primary, #C5A059). `text-primary` on the rect re-points its own
          currentColor, leaving the wordmark black — and white on the dark
          footer — while the mark stays gold in either lockup. */}
      <rect
        x="6"
        y="16"
        width="108"
        height="108"
        fill="none"
        className="text-primary"
        stroke="currentColor"
        strokeWidth="5"
      />
      <text
        x="140"
        y="112"
        fill="currentColor"
        fontFamily="var(--font-tenor), Georgia, 'Times New Roman', serif"
        fontSize="96"
        fontWeight="700"
        letterSpacing="0.02em"
      >
        LINX
      </text>
      <text
        x="445"
        y="112"
        fill="currentColor"
        fontFamily="var(--font-tenor), Georgia, 'Times New Roman', serif"
        fontSize="44"
        fontWeight="400"
        letterSpacing="0.42em"
      >
        SQUARE
      </text>
    </svg>
  );
}

export function BrandLogo({
  className,
  variant = "default",
  size = "md",
  name = "Linx Square",
}: BrandLogoProps) {
  return (
    <span
      className={cn(
        // max-w-full lets the mark scale down inside a shrinking flex parent
        // instead of spilling over neighbouring header controls.
        "inline-flex items-center leading-none shrink-0 max-w-full",
        // Black, not `text-foreground` — that token is 10% off black and the
        // mark read as grey beside the menu.
        variant === "light" ? "text-white" : "text-black",
        className,
      )}
    >
      <LinxSquareMark title={name} className={sizeClasses[size]} />
    </span>
  );
}

import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  /** Light text for dark backgrounds (e.g. footer) */
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg";
  /** Kept for callers / accessibility */
  name?: string;
}

/**
 * Fixed width, height locked to the 920x140 viewBox via aspect-ratio (rather
 * than a separate fixed height) so that when the header icon cluster leaves
 * less room than the target width and `max-w-full` shrinks it, the height
 * scales down with it instead of staying fixed and squashing the mark.
 */
const sizeClasses = {
  sm: "w-[8.2rem] sm:w-[9.85rem] lg:w-[11.5rem]",
  md: "w-[11.5rem] sm:w-[14.8rem]",
  lg: "w-[14.8rem] sm:w-[19.7rem]",
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
      viewBox="0 0 920 140"
      role="img"
      aria-label={title}
      className={cn("block max-w-full h-auto aspect-920/140", className)}
      preserveAspectRatio="xMinYMid meet"
    >
      <title>{title}</title>
      <rect
        x="6"
        y="16"
        width="108"
        height="108"
        fill="none"
        stroke="#A6894E"
        strokeWidth="3.25"
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
        variant === "light" ? "text-white" : "text-foreground",
        className,
      )}
    >
      <LinxSquareMark title={name} className={sizeClasses[size]} />
    </span>
  );
}

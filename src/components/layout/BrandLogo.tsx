import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  /** Light frame for dark backgrounds (e.g. footer) */
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg";
  /** Kept for callers / accessibility */
  name?: string;
}

const sizeClasses = {
  sm: "h-7 w-auto",
  md: "h-9 w-auto",
  lg: "h-12 w-auto",
};

/** Inline SVG logo — crisp at any size; matches public/linxSquarelogo.svg */
function LinxSquareMark({ className, title }: { className?: string; title: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 920 140"
      role="img"
      aria-label={title}
      className={cn("block", className)}
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
        className="font-serif"
        style={{
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: "0.02em",
        }}
      >
        LINX
      </text>
      <text
        x="445"
        y="112"
        fill="currentColor"
        className="font-serif"
        style={{
          fontSize: 44,
          fontWeight: 400,
          letterSpacing: "0.42em",
        }}
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
        "inline-flex items-center leading-none",
        variant === "light" ? "text-white" : "text-foreground",
        className,
      )}
    >
      <LinxSquareMark title={name} className={sizeClasses[size]} />
    </span>
  );
}

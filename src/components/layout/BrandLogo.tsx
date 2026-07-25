import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  /** Text colour on dark backgrounds (e.g. footer) */
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg";
  name?: string;
}

const sizeClasses = {
  sm: "text-sm tracking-[0.16em]",
  md: "text-base sm:text-lg md:text-xl tracking-[0.2em]",
  lg: "text-xl sm:text-2xl tracking-[0.22em]",
};

export function BrandLogo({
  className,
  variant = "default",
  size = "md",
  name = "Linx Square",
}: BrandLogoProps) {
  const [firstWord, ...rest] = name.trim().split(/\s+/);
  const remainder = rest.join(" ");

  return (
    <span
      className={cn(
        "font-serif uppercase whitespace-nowrap leading-none",
        sizeClasses[size],
        variant === "light" ? "text-white" : "text-foreground",
        className,
      )}
    >
      <span className="font-bold">{firstWord}</span>
      {remainder ? (
        <>
          {" "}
          <span className="font-normal">{remainder}</span>
        </>
      ) : null}
    </span>
  );
}

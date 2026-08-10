import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title?: string;
  description?: string;
  breadcrumb?: { label: string; href?: string }[];
  theme?: "light" | "dark";
  /** Linx Glass shop-style: left-aligned title + body description */
  variant?: "default" | "catalogue";
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  theme = "light",
  variant = "default",
}: PageHeaderProps) {
  const isCatalogue = variant === "catalogue";

  return (
    <section
      className={cn(
        "border-b",
        isCatalogue
          ? "page-top pb-6 sm:pb-8 md:pb-10 px-4 sm:px-6 lg:px-12 xl:px-20"
          : "page-top pb-5 md:pb-10 px-4 sm:px-6 lg:px-20",
        theme === "dark"
          ? "bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))] border-white/5"
          : "bg-background border-foreground/5",
      )}
    >
      <div
        className={cn(
          "mx-auto",
          isCatalogue ? "max-w-8xl space-y-5" : "max-w-7xl space-y-6",
        )}
      >
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav
            className={cn(
              "flex flex-wrap items-center gap-1.5",
              isCatalogue
                ? "text-sm text-muted-foreground"
                : "gap-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold",
            )}
          >
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            {breadcrumb.map((item, index) => {
              const isLast = index === breadcrumb.length - 1;
              return (
                <div key={`${item.label}-${index}`} className="flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  {item.href && !isLast ? (
                    <Link
                      href={item.href}
                      className="hover:text-foreground transition-colors"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        isLast && "text-foreground font-medium",
                        !isCatalogue && isLast && "text-primary",
                      )}
                    >
                      {item.label}
                    </span>
                  )}
                </div>
              );
            })}
          </nav>
        ) : null}

        <div className={cn(isCatalogue ? "space-y-3 sm:space-y-4" : "space-y-4")}>
          {title ? (
            <h1
              className={cn(
                isCatalogue
                  ? "text-2xl sm:text-3xl md:text-5xl font-serif font-semibold text-foreground leading-tight text-left"
                  : "text-2xl md:text-3xl text-center font-serif tracking-tight uppercase leading-none text-primary",
              )}
            >
              {title}
            </h1>
          ) : null}
          {description ? (
            <p
              className={cn(
                isCatalogue
                  ? "text-muted-foreground text-sm sm:text-base md:text-lg leading-relaxed max-w-3xl text-left"
                  : "text-center text-sm text-muted-foreground max-w-2xl mx-auto",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: { label: string; href: string }[];
  theme?: "light" | "dark";
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  theme = "light",
}: PageHeaderProps) {
  return (
    <section 
      className={`pt-32 md:pt-48 pb-5 md:pb-10 px-6 lg:px-20 border-b ${
        theme === "dark" 
          ? "bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))] border-white/5" 
          : "bg-background border-foreground/5"
      }`}
    >
      <div className="max-w-7xl mx-auto space-y-6">
        {breadcrumb && (
          <nav className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            <Link href="/" className="hover:text-primary transition-colors">
              Home
            </Link>
            {breadcrumb.map((item, index) => (
              <div key={item.href} className="flex items-center gap-2">
                <ChevronRight className="w-3 h-3" />
                <Link
                  href={item.href}
                  className={
                    index === breadcrumb.length - 1
                      ? "text-primary"
                      : "hover:text-primary transition-colors"
                  }
                >
                  {item.label}
                </Link>
              </div>
            ))}
          </nav>
        )}

        <div className="space-y-4">
          <h1 className="text-2xl md:text-3xl text-center font-serif tracking-tight uppercase leading-none text-primary">
            {title}
          </h1>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";

export function TrackOrderHome() {
  return (
    <section className="py-10 sm:py-12 md:py-16 bg-secondary/40 border-y border-foreground/8">
      <div className="site-container flex flex-col md:flex-row md:items-center md:justify-between gap-6 md:gap-8">
        <div className="flex items-start gap-4 sm:gap-5 max-w-lg min-w-0">
          <span className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center border border-foreground/15 text-primary">
            <PackageSearch className="w-5 h-5" />
          </span>
          <div className="min-w-0 space-y-1.5 sm:space-y-2">
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary">
              Client service
            </p>
            <h2 className="font-serif text-xl md:text-2xl tracking-[0.05em]">
              Track your order
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Enter your order ID for live status updates.
            </p>
          </div>
        </div>
        <Link
          href="/track-order"
          className="inline-flex w-full md:w-auto items-center justify-center gap-3 px-6 py-3 md:py-2.5 bg-foreground text-background uppercase tracking-[0.25em] text-[10px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors shrink-0"
        >
          Track order
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  );
}

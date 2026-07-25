import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";

export function TrackOrderHome() {
  return (
    <section className="px-6 lg:px-20 py-12 md:py-16 bg-secondary/40 border-y border-foreground/8">
      <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-8">
        <div className="flex items-start gap-5 max-w-lg">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center border border-foreground/15 text-primary">
            <PackageSearch className="w-5 h-5" />
          </span>
          <div className="space-y-2">
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
          className="inline-flex items-center gap-3 px-6 py-2.5 bg-foreground text-background uppercase tracking-[0.25em] text-[10px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors shrink-0"
        >
          Track order
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  );
}

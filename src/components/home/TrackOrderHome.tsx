import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";

export function TrackOrderHome() {
  return (
    <section
      className="relative overflow-hidden bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))]"
      aria-labelledby="track-order-home-heading"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-[-6%] h-[22rem] w-[22rem] rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-[-8%] h-[18rem] w-[18rem] rounded-full bg-white/[0.04] blur-3xl"
      />

      <div className="relative max-w-[1400px] mx-auto px-6 lg:px-20 py-16 md:py-24">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-10 md:gap-16">
          <div className="max-w-xl space-y-4">
            <p className="uppercase tracking-[0.4em] text-[10px] font-bold text-primary">
              Client service
            </p>
            <h2
              id="track-order-home-heading"
              className="font-serif text-3xl md:text-4xl tracking-[0.1em] text-white"
            >
              Track Order
            </h2>
            <p className="text-white/55 text-sm leading-relaxed">
              Enter your order ID and checkout email to see live status — from
              processing through to delivery.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 shrink-0">
            <div className="hidden sm:flex items-center justify-center w-14 h-14 border border-white/15 text-primary">
              <PackageSearch className="w-6 h-6" />
            </div>
            <Link
              href="/track-order"
              className="inline-flex items-center gap-3 px-8 py-4 bg-white text-black uppercase tracking-[0.25em] text-[10px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              Track your order
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

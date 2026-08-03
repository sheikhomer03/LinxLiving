import Link from "next/link";

interface BrandStoryProps {
  storeName: string;
}

export function BrandStory({ storeName }: BrandStoryProps) {
  return (
    <section className="relative overflow-hidden bg-foreground text-background py-12 sm:py-16 md:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 w-1/2 h-full bg-[radial-gradient(ellipse_at_top_right,_hsl(40_46%_56%/_0.15),_transparent_60%)]"
      />

      <div className="relative site-container grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <div className="space-y-6">
          <p className="uppercase tracking-[0.22em] text-[10px] font-bold text-primary">
            About {storeName}
          </p>
          <h2 className="font-serif text-2xl md:text-3xl tracking-[0.04em] leading-tight">
            Materials for spaces that endure
          </h2>
          <p className="text-background/65 text-sm md:text-base leading-relaxed max-w-lg">
            We curate architectural tiles, stone, and fixtures for residential
            and commercial projects — combining showroom-quality finishes with
            trade-ready specification support.
          </p>
        </div>

        <div className="space-y-8 lg:pl-8 lg:border-l lg:border-background/15">
          {[
            { n: "01", label: "Architect specified", detail: "Materials chosen for real projects" },
            { n: "02", label: "Showroom standard", detail: "Finish, tone, and tolerance reviewed" },
            { n: "03", label: "Trade ready", detail: "Support from enquiry to installation" },
          ].map((item) => (
            <div key={item.n} className="flex gap-6">
              <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary shrink-0 pt-1">
                {item.n}
              </span>
              <div className="space-y-1">
                <p className="font-serif text-lg tracking-[0.08em] uppercase">
                  {item.label}
                </p>
                <p className="text-sm text-background/55 leading-relaxed">
                  {item.detail}
                </p>
              </div>
            </div>
          ))}

          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 pt-4">
            <Link
              href="/contact"
              className="inline-flex justify-center px-8 py-4 bg-background text-foreground uppercase tracking-[0.25em] text-[10px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors w-full sm:w-auto"
            >
              Contact us
            </Link>
            <Link
              href="/custom"
              className="inline-flex justify-center px-8 py-4 border border-background/30 uppercase tracking-[0.25em] text-[10px] font-bold hover:border-primary hover:text-primary transition-colors w-full sm:w-auto"
            >
              Bespoke service
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";

interface BrandStoryProps {
  storeName: string;
}

const PILLARS = [
  { label: "Architect specified", detail: "Materials chosen for real projects" },
  { label: "Showroom standard", detail: "Finish, tone, and tolerance reviewed" },
  { label: "Trade ready", detail: "Support from enquiry to installation" },
];

export function BrandStory({ storeName }: BrandStoryProps) {
  return (
    <section className="bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))] px-6 lg:px-20 py-20 md:py-28">
      <div className="max-w-[1400px] mx-auto space-y-14">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <p className="uppercase tracking-[0.35em] text-[10px] font-bold text-primary">
            Our world
          </p>
          <h2 className="text-3xl md:text-4xl font-serif tracking-[0.08em] leading-tight text-white">
            Luxury bathrooms, kitchens & home collections
          </h2>
          <p className="text-white/65 text-sm md:text-base leading-relaxed">
            {storeName} curates architectural materials and fixtures for
            residential and commercial settings. We combine expert craftsmanship
            with understated elegance — natural stone, refined ceramics, and
            finishes specified for longevity.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link
              href="/contact"
              className="inline-flex px-10 py-4 bg-white text-black uppercase tracking-[0.25em] text-[11px] font-bold hover:bg-primary hover:text-primary-foreground transition-colors duration-500"
            >
              Contact us
            </Link>
            <Link
              href="/custom"
              className="inline-flex px-10 py-4 border border-white/30 text-white uppercase tracking-[0.25em] text-[11px] font-bold hover:border-primary hover:text-primary transition-colors duration-500"
            >
              Bespoke service
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6 max-w-4xl mx-auto">
          {PILLARS.map((item) => (
            <div
              key={item.label}
              className="space-y-2 border-t border-white/15 pt-6 text-center sm:text-left"
            >
              <p className="font-serif text-lg tracking-[0.08em] uppercase text-white">
                {item.label}
              </p>
              <p className="text-white/55 text-xs leading-relaxed tracking-wide">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

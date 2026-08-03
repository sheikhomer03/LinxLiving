import { Truck, ShieldCheck, Store, Headset } from "lucide-react";

interface TrustStripProps {
  storeName?: string;
}

const USPS = [
  {
    icon: Truck,
    label: "Nationwide delivery",
    detail: "Carefully packed and delivered to site",
  },
  {
    icon: ShieldCheck,
    label: "Quality assured",
    detail: "Showroom-standard materials, checked twice",
  },
  {
    icon: Store,
    label: "Visit the showroom",
    detail: "See tone and texture in person",
  },
  {
    icon: Headset,
    label: "Expert support",
    detail: "Guidance from enquiry to installation",
  },
];

export function TrustStrip({ storeName }: TrustStripProps) {
  return (
    <section
      aria-label={`Why shop with ${storeName || "us"}`}
      className="bg-background border-y border-foreground/8"
    >
      <div className="site-container py-10 sm:py-14 md:py-16 grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10 lg:gap-8">
        {USPS.map((item, i) => (
          <div key={item.label} className="space-y-2.5 sm:space-y-3 min-w-0">
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary/80">
              0{i + 1}
            </span>
            <item.icon className="w-5 h-5 text-foreground/70 stroke-[1.25]" />
            <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-foreground leading-snug">
              {item.label}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {item.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

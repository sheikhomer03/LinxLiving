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
      className="border-y border-foreground/10 bg-background px-6 lg:px-20 py-10 md:py-12"
    >
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
        {USPS.map((item) => (
          <div key={item.label} className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-primary/40 text-primary">
              <item.icon className="w-5 h-5 stroke-[1.5]" />
            </span>
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-foreground">
                {item.label}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {item.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

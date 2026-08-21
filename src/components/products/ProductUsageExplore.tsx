import Image from "next/image";
import { Check } from "lucide-react";
import {
  hasUsageItems,
  type ProductUsageItem,
} from "@/lib/productOttoSections";

/**
 * Separate Explore / Tile Usage block on the PDP when Usage items exist.
 */
export function ProductUsageExplore({
  usage,
}: {
  usage?: ProductUsageItem[] | null;
}) {
  const items = (usage || []).filter((u) => u.image || u.title);
  if (!hasUsageItems(items)) return null;

  return (
    <section className="mt-16 md:mt-24 pt-10 border-t border-foreground/10">
      <div className="text-center mb-10 space-y-2">
        <p className="uppercase tracking-[0.35em] text-[10px] font-bold text-foreground/60">
          Explore
        </p>
        <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
          Tile Usage
        </h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6 md:gap-8 max-w-5xl mx-auto">
        {items.map((item, i) => (
          <div
            key={`${item.title}-${i}`}
            className="flex flex-col items-center text-center gap-3"
          >
            <div className="relative w-16 h-16 md:w-20 md:h-20">
              {item.image ? (
                <Image
                  src={item.image}
                  alt={item.title || "Usage"}
                  fill
                  className="object-contain"
                  sizes="80px"
                  unoptimized
                />
              ) : null}
              {item.checked ? (
                <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                </span>
              ) : null}
            </div>
            {item.title ? (
              <p className="text-[11px] md:text-xs uppercase tracking-wide font-semibold text-foreground/80">
                {item.title}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

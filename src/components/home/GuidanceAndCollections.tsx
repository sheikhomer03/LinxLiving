import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export type GuidanceCard = {
  eyebrow: string;
  title: string;
  copy: string;
  href: string;
  cta: string;
  image: string;
  alt: string;
};

interface GuidanceAndCollectionsProps {
  shopLink: string;
  /** Optional real product images for the two promo panels */
  images?: [string?, string?];
}

const CARD_COPY = (shopLink: string): Omit<GuidanceCard, "image" | "alt">[] => [
  {
    eyebrow: "Expertly curated advice",
    title: "Discover your perfect pieces",
    copy: "Considered guidance to help you refine every detail of your space with confidence.",
    href: "/faq",
    cta: "Read the guides",
  },
  {
    eyebrow: "Curated collections",
    title: "Designed to inspire every space",
    copy: "Beautifully composed ranges brought together to create elevated interiors.",
    href: shopLink,
    cta: "Shop collections",
  },
];

/** Prefer two different URLs when the pool repeats the same lifestyle shot. */
function distinctPair(images: [string?, string?]): [string, string] {
  const a = (images[0] || "").trim();
  const b = (images[1] || "").trim();
  if (a && b && a !== b) return [a, b];
  if (a && !b) return [a, ""];
  if (!a && b) return ["", b];
  return [a, b];
}

export function GuidanceAndCollections({
  shopLink,
  images = [],
}: GuidanceAndCollectionsProps) {
  const [imgA, imgB] = distinctPair(images);
  const cards = CARD_COPY(shopLink).map((card, i) => ({
    ...card,
    image: (i === 0 ? imgA : imgB) || "",
    alt: card.title,
  }));

  return (
    <section className="bg-background px-5 sm:px-6 lg:px-0 py-10 sm:py-12 lg:py-0">
      <div className="mx-auto max-w-[1600px] lg:max-w-none grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 lg:gap-0">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group relative flex flex-col overflow-hidden rounded-sm lg:rounded-none bg-[hsl(var(--dark-section))] text-white lg:min-h-[min(44vh,520px)]"
          >
            {/* Mobile: image band above copy. Desktop: full-bleed background. */}
            <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden sm:aspect-[16/9] lg:absolute lg:inset-0 lg:aspect-auto">
              {card.image ? (
                <Image
                  src={card.image}
                  alt={card.alt}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              ) : (
                <div
                  aria-hidden
                  className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(40_46%_56%/_0.18),_transparent_55%)]"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--dark-section))] via-black/30 to-black/10 lg:from-black/85 lg:via-black/45 lg:to-black/25 transition-colors duration-500 group-hover:from-black/90" />
            </div>

            <div className="relative z-10 flex flex-1 flex-col justify-end gap-3 p-5 sm:p-6 md:p-8 lg:absolute lg:inset-0 lg:justify-end lg:p-10 xl:p-12 bg-[hsl(var(--dark-section))] lg:bg-transparent">
              <p className="inline-flex w-fit uppercase tracking-[0.2em] text-[10px] font-bold text-primary bg-black px-2.5 py-1">
                {card.eyebrow}
              </p>
              <h2 className="font-serif text-xl sm:text-2xl tracking-[0.05em] leading-snug">
                {card.title}
              </h2>
              <p className="text-sm text-white/75 leading-relaxed max-w-md">
                {card.copy}
              </p>
              <span className="mt-1 inline-flex w-full sm:w-auto items-center justify-center gap-3 px-6 py-3 bg-white text-black uppercase tracking-[0.18em] text-[10px] font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-500">
                {card.cta}
                <ArrowRight className="w-3.5 h-3.5 transition-transform duration-500 group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

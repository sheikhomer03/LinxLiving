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

export function GuidanceAndCollections({
  shopLink,
  images = [],
}: GuidanceAndCollectionsProps) {
  const cards = CARD_COPY(shopLink).map((card, i) => ({
    ...card,
    image: images[i]?.trim() || "",
    alt: card.title,
  }));

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2">
      {cards.map((card) => (
        <Link
          key={card.title}
          href={card.href}
          className="group relative block min-h-[48vh] lg:min-h-[56vh] overflow-hidden bg-[hsl(var(--dark-section))]"
        >
          {card.image ? (
            <Image
              src={card.image}
              alt={card.alt}
              fill
              className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10 transition-colors duration-500 group-hover:from-black/90" />
          <div className="absolute inset-0 flex items-end p-8 md:p-12 text-white">
            <div className="space-y-4 max-w-md">
              <p className="uppercase tracking-[0.35em] text-[10px] font-bold text-primary">
                {card.eyebrow}
              </p>
              <h2 className="text-2xl md:text-3xl font-serif tracking-[0.08em]">
                {card.title}
              </h2>
              <p className="text-sm text-white/75 leading-relaxed">
                {card.copy}
              </p>
              <span className="inline-flex items-center gap-3 px-7 py-3.5 bg-white text-black uppercase tracking-[0.25em] text-[10px] font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-500">
                {card.cta}
                <ArrowRight className="w-3.5 h-3.5 transition-transform duration-500 group-hover:translate-x-1" />
              </span>
            </div>
          </div>
        </Link>
      ))}
    </section>
  );
}

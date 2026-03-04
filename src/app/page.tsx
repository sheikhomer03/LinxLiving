import { Navbar } from "@/components/layout/Navbar";
import { Hero } from "@/components/home/Hero";
import { Footer } from "@/components/layout/Footer";
import { CollectionCard } from "@/components/home/CollectionCard";
import { ProductCard } from "@/components/products/ProductCard";
import { Star, Quote } from "lucide-react";
import Image from "next/image";
import { getStoreName } from "@/app/actions/settings";

const COLLECTIONS = [
  {
    title: "Carrara Marble",
    subtitle: "Timeless Italian Elegance",
    image: "/images/tiles1.jpg",
    href: "/collections/carrara",
  },
  {
    title: "Ceramic Textures",
    subtitle: "Modern al Finish",
    image: "/images/tiles2.jpg",
    href: "/collections/ceramic",
  },
  {
    title: "Stone Basins",
    subtitle: "Minimalist Sculptures",
    image: "/images/tiles3.jpg",
    href: "/collections/stone-basins",
  },
];

const TRENDING_PRODUCTS = [
  {
    id: "65e49c7a2f5a2b1a3c4d5e60",
    name: "Kensington Vanity Unit & Stone Basin 800mm Walnut",
    price: 997.0,
    category: "Vanity",
    image: "/images/tiles4.jpg",
  },
  {
    id: "65e49c7a2f5a2b1a3c4d5e61",
    name: "Rotunda Fluted Vanity Unit & Stone Basin 600mm Smoked Oak",
    price: 1097.0,
    category: "Vanity",
    image: "/images/tiles5.jpg",
  },
  {
    id: "65e49c7a2f5a2b1a3c4d5e62",
    name: "Nero Curved Stone Vanity Unit 600mm",
    price: 697.0,
    category: "Vanity",
    image: "/images/tiles6.jpg",
  },
  {
    id: "65e49c7a2f5a2b1a3c4d5e63",
    name: "Park Lane Vanity Unit & Stone Basin 800mm Sabbia Grigio Oak",
    price: 897.0,
    category: "Vanity",
    image: "/images/tiles1.jpg",
  },
];

const getReviews = (storeName: string) => [
  {
    id: 1,
    name: "Alexander Vance",
    role: "Interior Architect",
    text: `The quality of the materials from ${storeName} is unparalleled. It completely transformed our Mayfair project.`,
    stars: 5,
  },
  {
    id: 2,
    name: "Eleanor Rigby",
    role: "Homeowner",
    text: "Minimalist design at its finest. The customer service and attention to detail reflect the luxury price point.",
    stars: 5,
  },
];

export default async function Home() {
  const storeName = await getStoreName();

  return (
    <main className="min-h-screen">
      <Navbar />
      <Hero />

      {/* Intro Section */}
      <section className="pt-32 pb-5 px-6 lg:px-20 text-center max-w-5xl mx-auto space-y-12">
        <h2 className="text-3xl md:text-4xl font-serif tracking-widest leading-tight">
          Crafting Spaces that <span className="italic">Inspire</span> & Endure
        </h2>
        <p className="text-muted-foreground leading-relaxed max-w-3xl mx-auto font-medium">
          {storeName} represents more than just surface materials. We curate
          architectural statements that define the very essence of luxury
          living, bringing al craftsmanship to the modern home.
        </p>
        <div className="w-px h-6 bg-foreground/10 mx-auto" />
      </section>

      {/* Featured Collections */}
      <section className="pb-32 px-6 lg:px-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {COLLECTIONS.map((collection) => (
            <CollectionCard key={collection.title} {...collection} />
          ))}
        </div>
      </section>

      {/* Craftsmanship Section */}
      <section className="py-32 px-6 lg:px-20 bg-secondary/30 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div className="space-y-8">
            <p className="uppercase tracking-[0.4em] text-[10px] font-bold">
              Unrivaled Quality
            </p>
            <h2 className="text-4xl md:text-5xl font-serif tracking-tight leading-tight">
              The Art of <br /> al Ceramics
            </h2>
            <p className="text-muted-foreground leading-relaxed font-medium">
              Every {storeName.toUpperCase()} tile is a testament to
              centuries-old techniques refined for the contemporary eye. Our
              master craftsmen select only the finest raw materials, ensuring
              each piece carries its own unique narrative and impeccable finish.
            </p>
            <div className="pt-8">
              <button className="luxury-underline uppercase tracking-widest text-[10px] font-bold">
                Read our story
              </button>
            </div>
          </div>
          <div className="relative aspect-square lg:aspect-video">
            <Image
              src="/images/tiles2.jpg"
              alt="Craftsmanship"
              fill
              className="object-cover grayscale"
            />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-background p-8 hidden md:block border">
              <p className="italic text-4xl">100%</p>
              <p className="uppercase tracking-widest text-[8px] mt-2 font-bold">
                Handmade
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trending Products */}
      <section className="py-24 px-6 lg:px-20">
        <div className="flex flex-col items-center text-center mb-16 space-y-4">
          <p className="uppercase tracking-[0.4em] text-[10px] font-bold">
            Selection
          </p>
          <h2 className="text-3xl font-serif tracking-[0.2em] uppercase">
            What's Trending
          </h2>
          <div className="w-12 h-px bg-foreground/10 mt-4" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-6">
          {TRENDING_PRODUCTS.map((product) => (
            <ProductCard key={product.id} {...product} />
          ))}
        </div>
      </section>

      {/* Social Proof / Reviews */}
      <section className="py-32 px-6 lg:px-20 bg-foreground text-background">
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center space-y-16">
          <Quote className="w-12 h-12 text-background/10" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 lg:gap-32">
            {getReviews(storeName).map((review) => (
              <div key={review.id} className="space-y-6">
                <div className="flex justify-center gap-1">
                  {[...Array(review.stars)].map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-current" />
                  ))}
                </div>
                <p className="text-xl md:text-2xl italic tracking-wide leading-relaxed">
                  &quot;{review.text}&quot;
                </p>
                <div className="pt-4">
                  <p className="uppercase tracking-widest text-[10px] font-bold">
                    {review.name}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-40 mt-1">
                    {review.role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter */}
      <section className="py-32 px-6 lg:px-20 text-center border-b">
        <div className="max-w-2xl mx-auto space-y-8">
          <h3 className="text-sm font-bold uppercase tracking-[0.3em]">
            Join the Inner Circle
          </h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Exclusive access to our private viewing events and seasonal
            catalogues.
          </p>
          <form className="flex input-standard flex-col sm:flex-row gap-4 mt-8">
            <input
              type="email"
              placeholder="EMAIL ADDRESS"
              className="flex-1 bg-transparent border-b border-foreground/20 py-4 px-2 text-xs tracking-widest focus:border-foreground outline-none transition-colors uppercase"
            />
            <button className="px-10 input-standard py-4 bg-foreground text-background uppercase tracking-widest text-[10px] font-bold hover:bg-accent hover:text-foreground transition-colors">
              Subscribe
            </button>
          </form>
        </div>
      </section>

      <Footer />
    </main>
  );
}

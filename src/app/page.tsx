import { Navbar } from "@/components/layout/Navbar";
import { Hero } from "@/components/home/Hero";
import { Footer } from "@/components/layout/Footer";
import { CollectionCard } from "@/components/home/CollectionCard";
import { ProductCard } from "@/components/products/ProductCard";
import { Star, Quote, PackageOpen, FolderOpen } from "lucide-react";
import Image from "next/image";
import { getStoreName } from "@/app/actions/settings";
import { getPublicCollections } from "@/app/actions/collections";
import { getPublicProducts } from "@/app/actions/products";
import { NewsletterForm } from "@/components/home/NewsletterForm";

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
  // Fetch most recent 3 collections
  const featuredCollections = await getPublicCollections(3);
  // Fetch most recent 4 products (from any category) with limited fields for performance
  const { products: dbProducts } = await getPublicProducts({
    limit: 8,
    sort: "newest",
    fields: "name price images category",
  });
  const trendingProducts = dbProducts;

  return (
    <main className="min-h-screen">
      <Navbar />
      <Hero />

      {/* Intro Section */}
      <section className="pt-20 pb-5 px-6 lg:px-20 text-center max-w-5xl mx-auto space-y-12">
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
      <section className="md:pb-32 px-6 lg:px-20">
        {featuredCollections.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {featuredCollections.map((collection: any) => (
              <CollectionCard
                key={collection._id}
                title={collection.name}
                image={collection.image || "/images/tiles1.jpg"}
                href={`/collections/${collection.slug}`}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 space-y-6 border border-foreground/5 bg-secondary/10 rounded-2xl">
            <FolderOpen className="w-12 h-12 stroke-[1] opacity-90" />
            <div className="space-y-1 text-center">
              <p className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
                Collections forthcoming
              </p>
              <p className="text-[9px] uppercase tracking-widest opacity-90">
                Our curated series are currently being archived
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Craftsmanship Section */}
      <section className="py-24 md:py-40 px-6 lg:px-20 bg-secondary border-y border-foreground/5 overflow-hidden">
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
            {/* <div className="pt-8">
              <button className="luxury-underline uppercase tracking-widest text-[10px] font-bold">
                Read our story
              </button>
            </div> */}
          </div>
          <div className="relative aspect-square lg:aspect-video">
            <Image
              src="/images/tiles2.jpg"
              alt="Craftsmanship"
              fill
              className="object-cover grayscale"
            />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-background p-8 hidden md:block border">
              <p className="italic text-4xl text-primary">100%</p>
              <p className="uppercase tracking-widest text-[8px] mt-2 font-bold text-primary">
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

        {trendingProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-6">
            {trendingProducts.map((product: any) => (
              <ProductCard
                key={product._id}
                id={product._id}
                name={product.name}
                price={product.price}
                image={product.images?.[0] || "/images/tiles1.jpg"}
                category={product.category}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-32 space-y-8 bg-secondary/10 rounded-3xl border border-dashed border-foreground/10">
            <PackageOpen className="w-16 h-16 stroke-1 opacity-90 animate-pulse" />
            <div className="space-y-2 text-center">
              <h3 className="text-xl font-serif tracking-widest uppercase opacity-80">
                Selection Expanding
              </h3>
              <p className="text-[9px] uppercase tracking-[0.4em] font-bold opacity-90">
                New architectural arrivals coming soon
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Social Proof / Reviews */}
      <section className="py-32 md:py-40 px-6 lg:px-20 bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))]">
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center space-y-16">
          <Quote className="w-12 h-12 text-background/10" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 lg:gap-32">
            {getReviews(storeName).map((review) => (
              <div key={review.id} className="space-y-6">
                <div className="flex justify-center gap-1">
                  {[...Array(review.stars)].map((_, i) => (
                    <Star
                      key={i}
                      className="w-3 h-3 fill-primary text-primary"
                    />
                  ))}
                </div>
                <p className="text-xl md:text-2xl italic tracking-wide leading-relaxed">
                  &quot;{review.text}&quot;
                </p>
                <div className="pt-4">
                  <p className="uppercase tracking-widest text-[10px] font-bold">
                    {review.name}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-80 mt-1">
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
          <NewsletterForm />
        </div>
      </section>

      <Footer />
    </main>
  );
}

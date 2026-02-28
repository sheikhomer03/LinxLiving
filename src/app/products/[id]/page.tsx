"use client";
import React, { use } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProductGallery } from "@/components/products/ProductGallery";
import { ProductSpecs } from "@/components/products/ProductSpecs";
import { ProductHighlight } from "@/components/products/ProductHighlight";
import { ProductReviews } from "@/components/products/ProductReviews";
import Link from "next/link";
import { useCartStore } from "@/store/useCartStore";
import { toast } from "sonner";
import { Heart, Share2, Mail, Phone } from "lucide-react";

const SIGNATURE_IMAGE = "/images/tiles4.jpg";

export default function ProductDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const addItem = useCartStore((state) => state.addItem);

  const product = {
    id: id,
    name: "Calacatta Gold Porcelain Tile 600x1200mm",
    price: 89.0, // per m2
    category: "Floor & Wall Tiles",
    images: [
      SIGNATURE_IMAGE,
      SIGNATURE_IMAGE,
      SIGNATURE_IMAGE,
      SIGNATURE_IMAGE,
    ],
    description:
      "A masterpiece of contemporary surfaces, our Calacatta Gold Porcelain tile captures the authentic essence of Italian marble. Featuring soft grey veining with subtle gold highlights, this high-performance porcelain offers the timeless beauty of natural stone with the durability required for modern living.",
    specs: [
      { label: "Material", value: "Polished Porcelain" },
      { label: "Finish", value: "High Gloss / Polished" },
      { label: "Size", value: "600 x 1200 mm" },
      { label: "Slip Rating", value: "R9" },
      { label: "Variation", value: "V2 - Slight Variation" },
      { label: "Suitability", value: "Internal Floor & Wall" },
      { label: "Rectified Edge", value: "Yes" },
      { label: "Thickness", value: "9.5 mm" },
    ],
  };

  const handleAddToCart = () => {
    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.images[0],
      category: product.category,
    });
    toast.success(`${product.name} added to your collection`);
  };

  return (
    <main className="min-h-screen">
      <Navbar />

      <div className="pt-52 pb-16 px-6 lg:px-20 max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <nav className="mb-12 flex items-center space-x-4 text-[10px] uppercase tracking-[0.3em] font-bold opacity-40">
          <Link href="/" className="hover:opacity-100 transition-opacity">
            Home
          </Link>
          <span>/</span>
          <Link href="/tiles" className="hover:opacity-100 transition-opacity">
            Tiles
          </Link>
          <span>/</span>
          <span className="opacity-100 font-extrabold">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20">
          {/* Left: Gallery */}
          <ProductGallery images={product.images} name={product.name} />

          {/* Right: Info */}
          <div className="space-y-12">
            <div className="space-y-6">
              <h1 className="text-3xl md:text-4xl font-serif tracking-wider">
                {product.name}
              </h1>
              <div className="flex items-center justify-between border-y border-foreground/5 py-6">
                <div className="space-y-1">
                  <p className="text-2xl font-serif">
                    £
                    {product.price.toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold">
                    Price per m² (Inc Vat)
                  </p>
                </div>
                <div className="flex space-x-2">
                  <button className="p-3 border border-foreground/10 hover:bg-secondary transition-colors">
                    <Heart className="w-4 h-4" />
                  </button>
                  <button className="p-3 border border-foreground/10 hover:bg-secondary transition-colors">
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Add to Collection & Sample Buttons */}
            <div className="flex space-x-2 pt-6">
              <button
                onClick={handleAddToCart}
                className="w-full bg-[#333] text-white py-5 text-center uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-colors shadow-lg shadow-black/5"
              >
                Add to Collection
              </button>
              <button className="w-full border border-[#333]/20 py-5 uppercase tracking-widest text-[10px] font-bold hover:bg-[#333] hover:text-white transition-all">
                Request Sample
              </button>
            </div>

            <div className="bg-secondary/30 p-8 space-y-4 border border-foreground/5">
              <p className="text-[10px] uppercase tracking-widest font-bold">
                Availability
              </p>
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <p className="text-xs uppercase tracking-widest">
                  In Stock - Ready for immediate dispatch
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Refined Product Details & CTA Section */}
        <section className="mt-32 pt-20 border-t border-foreground/5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-32">
            {/* Left Column: Narrative Details */}
            <div className="lg:col-span-5 space-y-10">
              <h2 className="text-[13px] uppercase tracking-[0.4em] font-bold text-[#333]">
                Product Details
              </h2>
              <div className="space-y-8">
                <p className="text-sm md:text-[15px] leading-[1.8] text-[#333]/80 font-sans max-w-2xl">
                  Introducing our {product.name.split(" ")[0]} collection,
                  meticulously designed to exude luxury and style. Perfect for
                  sophisticated spaces, this {product.category.toLowerCase()}
                  features authentic textures and durable finishes. Each piece
                  captures a timeless charm that seamlessly blends practicality
                  with opulence, making it the quintessential addition to any
                  modern project seeking an air of luxury.
                </p>
                <div className="space-y-4 pt-4 border-l border-[#333]/10 pl-8 italic text-[#333]/60 text-sm">
                  <p>
                    Discover our full collection of{" "}
                    <Link
                      href="/tiles"
                      className="underline underline-offset-4 hover:text-[#333] transition-colors"
                    >
                      luxury surfaces
                    </Link>
                    .
                  </p>
                  <p>
                    For more options in bespoke finishes, explore our{" "}
                    <Link
                      href="/tiles"
                      className="underline underline-offset-4 hover:text-[#333] transition-colors"
                    >
                      material catalog
                    </Link>{" "}
                    for additional designs.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: CTAs */}
            <div className="lg:col-span-4 space-y-8">
              <h3 className="text-[13px] uppercase tracking-[0.2em] font-bold text-[#333]">
                Got a Question?
              </h3>
              <div className="space-y-3">
                <button className="w-full border border-[#333]/10 py-5 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 transition-all group">
                  <Mail className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                  Contact Us
                </button>
                <button className="w-full border border-[#333]/10 py-5 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 transition-all group">
                  <Phone className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                  Call us on 020 3488 5937
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-20">
        <ProductHighlight
          title="The Essence of Italian Sophistication"
          description="Each tile is meticulously crafted to showcase the dramatic veining and variations found in natural Calacatta marble. Our advanced HD printing technology ensures no two tiles are identical within a 15m² area, providing an incredibly authentic architectural finish."
          image={SIGNATURE_IMAGE}
        />

        <ProductSpecs specs={product.specs} schematicImage={SIGNATURE_IMAGE} />

        <ProductHighlight
          reverse
          title="Precision Engineered Edges"
          description="These tiles are rectified, meaning they are cut to exact specifications after firing. This allows for minimal grout lines (as low as 1.5mm), creating a seamless, high-end look that is both easier to clean and visually stunning across large open spaces."
          image={SIGNATURE_IMAGE}
        />
      </div>

      {/* Trust Quote / Reassurance */}
      <section className="py-32 bg-secondary/20 text-center border-y border-foreground/5">
        <div className="max-w-3xl mx-auto px-6 space-y-8">
          <h3 className="text-sm font-bold uppercase tracking-[0.4em]">
            Handpicked Perfection
          </h3>
          <p className="text-xl md:text-2xl font-serif italic text-muted-foreground leading-relaxed">
            "We believe that the foundation of any luxury space starts with the
            materials. Our tiles are curated for those who seek the
            extraordinary in every detail."
          </p>
          <div className="w-px h-12 bg-foreground/10 mx-auto" />
        </div>
      </section>

      <ProductReviews />

      <Footer />
    </main>
  );
}

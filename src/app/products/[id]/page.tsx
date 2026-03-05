import React from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProductGallery } from "@/components/products/ProductGallery";
import { ProductSpecs } from "@/components/products/ProductSpecs";
import { ProductHighlight } from "@/components/products/ProductHighlight";
import { ProductReviews } from "@/components/products/ProductReviews";
import Link from "next/link";
import { Heart, Share2, Mail, Phone } from "lucide-react";
import { ShareButton } from "@/components/products/ShareButton";
import { WishlistButton } from "@/components/products/WishlistButton";
import { getPublicProduct } from "@/app/actions/products";
import { notFound } from "next/navigation";
import { AddToCartButton } from "@/components/products/AddToCartButton";

const SIGNATURE_IMAGE = "/images/tiles4.jpg";

export default async function ProductDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getPublicProduct(id);

  if (!product) {
    notFound();
  }

  // Convert specs object to array format for UI
  const productSpecs = Object.entries(product.specs || {}).map(
    ([label, value]) => ({
      label,
      value: String(value),
    }),
  );

  const images =
    product.images && product.images.length > 0
      ? product.images
      : [SIGNATURE_IMAGE];

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
          <ProductGallery images={images} name={product.name} />

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
                    {(product.price || 0).toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold">
                    Price per m² (Inc Vat)
                  </p>
                </div>
                <div className="flex space-x-2">
                  <ShareButton />
                </div>
              </div>
            </div>

            {/* Add to Collection & Sample Buttons */}
            <div className="flex space-x-2 pt-6">
              <AddToCartButton
                product={{
                  id: product._id,
                  name: product.name,
                  price: product.price,
                  image: images[0],
                  category: product.category,
                }}
              />
              <WishlistButton
                variant="full"
                product={{
                  id: product._id,
                  name: product.name,
                  price: product.price,
                  image: images[0],
                  category: product.category,
                }}
              />
            </div>

            <div className="bg-secondary/30 p-8 space-y-4 border border-foreground/5">
              <p className="text-[10px] uppercase tracking-widest font-bold">
                Availability
              </p>
              <div className="flex items-center space-x-3">
                <div
                  className={`w-2 h-2 rounded-full ${product.stock > 0 ? "bg-green-500" : "bg-red-500"}`}
                />
                <p className="text-xs uppercase tracking-widest">
                  {product.stock > 0
                    ? `In Stock (${product.stock}) - Ready for immediate dispatch`
                    : "Currently Out of Stock"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Refined Product Details & CTA Section */}
        <section className="mt-32 pt-20 border-t border-foreground/5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-24">
            {/* Left Column: Narrative Details */}
            <div className="lg:col-span-7 space-y-10">
              <h2 className="text-[13px] uppercase tracking-[0.4em] font-bold text-[#333]">
                Product Details
              </h2>
              <div className="space-y-8">
                <p className="text-sm md:text-[15px] leading-[1.8] text-[#333]/80 font-sans max-w-4xl">
                  {product.description}
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
                </div>
              </div>
            </div>

            {/* Right Column: CTAs */}
            <div className="lg:col-span-5 space-y-8">
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

      <div className="max-w-7xl mx-auto px-6">
        {/* <ProductHighlight
          title="The Essence of Italian Sophistication"
          description="Each tile is meticulously crafted to showcase the dramatic veining and variations found in natural Calacatta marble. Our advanced HD printing technology ensures no two tiles are identical within a 15m² area, providing an incredibly authentic architectural finish."
          image={SIGNATURE_IMAGE}
        /> */}

        <ProductSpecs
          specs={productSpecs}
          schematicImage={product.schematicImage || images[0]}
        />

        {/* <ProductHighlight
          reverse
          title="Precision Engineered Edges"
          description="These tiles are rectified, meaning they are cut to exact specifications after firing. This allows for minimal grout lines (as low as 1.5mm), creating a seamless, high-end look that is both easier to clean and visually stunning across large open spaces."
          image={SIGNATURE_IMAGE}
        /> */}
      </div>

      {/* Trust Quote / Reassurance */}
      <section className="py-32 bg-secondary/20 text-center border-y border-foreground/5">
        <div className="max-w-3xl mx-auto px-6 space-y-8">
          <p className="text-xl md:text-2xl font-serif italic text-muted-foreground leading-relaxed">
            "{product.tagline || "Handpicked Perfection"}"
          </p>
          <div className="w-px h-12 bg-foreground/10 mx-auto" />
        </div>
      </section>

      <ProductReviews />

      <Footer />
    </main>
  );
}

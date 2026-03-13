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
import { getPublicProduct, getPublicProducts } from "@/app/actions/products";
import { getCollectionBySlug } from "@/app/actions/collections";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/products/ProductCard";
import { PackageOpen } from "lucide-react";
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

  // Fetch collection for breadcrumb
  const collection = await getCollectionBySlug(product.category);

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

  // Fetch most recent 4 products for Trending section
  const { products: trendingProducts } = await getPublicProducts({
    limit: 8,
    sort: "newest",
    fields: "name price images category",
  });

  return (
    <main className="min-h-screen">
      <Navbar />

      <div className="pt-32 md:pt-52 pb-16 px-6 lg:px-20 max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <nav className="mb-12 flex items-center space-x-4 text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
          <Link href="/" className="hover:opacity-800 transition-opacity">
            Home
          </Link>
          <span>/</span>
          <Link
            href={`/${product.category}`}
            className="hover:opacity-800 transition-opacity"
          >
            {collection?.name || product.category}
          </Link>
          <span>/</span>
          <span className="opacity-800 font-extrabold">{product.name}</span>
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
                  <p className="text-[10px] uppercase tracking-widest opacity-80 font-bold">
                    Price per m² (Inc Vat)
                  </p>
                </div>
                <div className="flex space-x-2">
                  <ShareButton />
                </div>
              </div>
            </div>

            {/* Add to Cart & Sample Buttons */}
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
                <p className="text-sm md:text-[15px] leading-[1.8] text-[#333]/80 font-sans max-w-4xl text-justify whitespace-pre-line">
                  {product.description}
                </p>
              </div>
            </div>

            {/* Right Column: CTAs */}
            <div className="lg:col-span-5 space-y-8">
              <h3 className="text-[13px] uppercase tracking-[0.2em] font-bold text-[#333]">
                Got a Question?
              </h3>
              <div className="space-y-3">
                <Link
                  href="mailto:info@linxliving.co.uk"
                  className="w-full border border-[#333]/10 py-5 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 transition-all group"
                >
                  <Mail className="w-3.5 h-3.5 opacity-80 group-hover:opacity-800 transition-opacity" />
                  Contact Us
                </Link>
                <Link
                  href="tel:02046342203"
                  className="w-full border border-[#333]/10 py-5 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 transition-all group"
                >
                  <Phone className="w-3.5 h-3.5 opacity-80 group-hover:opacity-800 transition-opacity" />
                  Call us on 020 4634 2203
                </Link>
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

        {product.showSpecs !== false && (
          <ProductSpecs
            specs={productSpecs}
            schematicImage={product.schematicImage || images[0]}
          />
        )}

        {/* <ProductHighlight
          reverse
          title="Precision Engineered Edges"
          description="These tiles are rectified, meaning they are cut to exact specifications after firing. This allows for minimal grout lines (as low as 1.5mm), creating a seamless, high-end look that is both easier to clean and visually stunning across large open spaces."
          image={SIGNATURE_IMAGE}
        /> */}
      </div>

      {/* Trending Products */}
      <section className="py-24 px-6 lg:px-20 border-t border-foreground/5 bg-secondary/5">
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
            {trendingProducts.map((trendingProduct: any) => (
              <ProductCard
                key={trendingProduct._id}
                id={trendingProduct._id}
                name={trendingProduct.name}
                price={trendingProduct.price}
                image={trendingProduct.images?.[0] || "/images/tiles1.jpg"}
                category={trendingProduct.category}
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

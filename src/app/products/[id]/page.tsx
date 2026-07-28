import React from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProductGallery } from "@/components/products/ProductGallery";
import { ProductDetailTabs } from "@/components/products/ProductDetailTabs";
import Link from "next/link";
import { ShareButton } from "@/components/products/ShareButton";
import { WishlistButton } from "@/components/products/WishlistButton";
import { getPublicProduct, getPublicProducts } from "@/app/actions/products";
import { getApprovedProductReviews } from "@/app/actions/reviews";
import { getMenuBySlug, getBrandMenuTrees } from "@/app/actions/admin";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/products/ProductCard";
import { PackageOpen } from "lucide-react";
import { AddToCartButton } from "@/components/products/AddToCartButton";
import { ProductAvailability } from "@/components/products/ProductAvailability";
import type { Metadata } from "next";
import { getProductDisplayImage, getProductGalleryImages } from "@/lib/productImage";
import { getStoreName } from "@/app/actions/settings";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [product, storeName] = await Promise.all([
    getPublicProduct(id),
    getStoreName(),
  ]);

  if (!product) {
    return {
      title: "Product Not Found",
    };
  }

  const title = `${product.name} | ${product.category.charAt(0).toUpperCase() + product.category.slice(1)} | ${storeName}`;
  const description = product.description
    ? product.description.substring(0, 160)
    : `Purchase ${product.name} from Linx Square. Premium ${product.category} for luxury architectural projects.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: getProductDisplayImage(product.images)
        ? [getProductDisplayImage(product.images)]
        : ["/images/og-image.jpg"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: getProductDisplayImage(product.images)
        ? [getProductDisplayImage(product.images)]
        : ["/images/og-image.jpg"],
    },
    alternates: {
      canonical: `/products/${id}`,
    },
  };
}

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

  const [category, { products: trendingProducts }, storeName, brandRes, reviewData] =
    await Promise.all([
      getMenuBySlug(product.category),
      getPublicProducts({
        limit: 8,
        sort: "newest",
        fields: "name price images category stock",
        skipCount: true,
      }),
      getStoreName(),
      getBrandMenuTrees(),
      getApprovedProductReviews(id),
    ]);

  // Convert specs object to array format for UI
  const productSpecs = Object.entries(product.specs || {}).map(
    ([label, value]) => ({
      label,
      value: String(value),
    }),
  );

  const gallery = getProductGalleryImages(product.images);
  const images = gallery.length > 0 ? gallery : [SIGNATURE_IMAGE];

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: images,
    sku: product._id,
    brand: {
      "@type": "Brand",
      name: "Linx Square",
    },
    offers: {
      "@type": "Offer",
      url: `https://linxliving.co.uk/products/${product._id}`,
      priceCurrency: "GBP",
      price: product.price,
      availability:
        product.stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
    },
  };

  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <Navbar
        initialBrandMenus={brandRes.brands || []}
        initialStoreName={storeName}
      />

      <div className="pt-32 md:pt-52 pb-16 px-6 lg:px-20 max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <nav className="mb-12 flex items-center space-x-4 text-[10px] uppercase tracking-[0.3em] font-bold opacity-80 flex-wrap">
          <Link href="/" className="hover:opacity-800 transition-opacity">
            Home /
          </Link>
          <Link
            href={`/${product.category}`}
            className="hover:opacity-800 transition-opacity"
          >
            {category?.name || product.category} /
          </Link>
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
                  stock: product.stock ?? 0,
                  shopifyVariantId: product.shopifyVariantId,
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

            <ProductAvailability
              productId={product._id}
              initialStock={product.stock ?? 0}
            />
          </div>
        </div>

        <ProductDetailTabs
          productId={product._id}
          description={product.description || ""}
          specs={productSpecs}
          showSpecs={product.showSpecs !== false}
          schematicImage={product.schematicImage || images[0]}
          reviews={reviewData.reviews}
          averageRating={reviewData.average}
          reviewCount={reviewData.count}
        />
      </div>

      {product.tagline ? (
        <section className="py-20 bg-secondary/20 text-center border-y border-foreground/5">
          <div className="max-w-3xl mx-auto px-6 space-y-6">
            <p className="text-xl md:text-2xl font-serif italic text-muted-foreground leading-relaxed">
              &ldquo;{product.tagline}&rdquo;
            </p>
            <div className="w-px h-10 bg-foreground/10 mx-auto" />
          </div>
        </section>
      ) : null}

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
                image={getProductDisplayImage(trendingProduct.images)}
                category={trendingProduct.category}
                stock={trendingProduct.stock}
                shopifyVariantId={trendingProduct.shopifyVariantId}
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

      <Footer initialStoreName={storeName} />
    </main>
  );
}

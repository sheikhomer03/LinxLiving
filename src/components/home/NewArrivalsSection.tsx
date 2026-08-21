import Image from "next/image";
import Link from "next/link";
import { ArrowRight, PackageOpen } from "lucide-react";
import { ProductCard } from "@/components/products/ProductCard";

import type { ShopifyImagePair } from "@/lib/productImage";

type Product = {
  _id: string;
  name: string;
  price: number;
  images?: string[];
  /** Shopify CDN copies, so a card survives Cloudinary being unreachable. */
  shopifyImages?: ShopifyImagePair[];
  category?: string;
  department?: string;
  /** Brand label so each card is attributed to its brand. */
  brandName?: string;
  brandSlug?: string;
  stock?: number;
  shopifyVariantId?: string | null;
};

interface NewArrivalsSectionProps {
  products: Product[];
  shopLink: string;
  getImage: (images?: string[]) => string;
}

export function NewArrivalsSection({
  products,
  shopLink,
  getImage,
}: NewArrivalsSectionProps) {
  const featured = products[0];
  const rest = products.slice(1, 7);

  return (
    <section className="py-14 md:py-20 bg-background">
      <div className="site-container space-y-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 border-b border-foreground/10 pb-10">
          <div className="space-y-3">
            <p className="uppercase tracking-[0.22em] text-[10px] font-bold text-primary">
              New in
            </p>
            <h2 className="font-serif text-2xl md:text-3xl tracking-[0.04em]">
              Latest arrivals
            </h2>
          </div>
          <Link
            href={shopLink}
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-bold hover:text-primary transition-colors shrink-0"
          >
            Shop all
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border border-dashed border-foreground/15">
            <PackageOpen className="w-14 h-14 stroke-1 opacity-40" />
            <p className="mt-6 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
              New arrivals coming soon
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {featured && (
              <Link
                href={`/products/${featured._id}`}
                className="lg:col-span-5 group relative aspect-[4/5] lg:aspect-auto lg:min-h-[400px] overflow-hidden bg-secondary"
              >
                {getImage(featured.images) ? (
                  <Image
                    src={getImage(featured.images)}
                    alt={featured.name}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    sizes="(max-width: 1024px) 100vw, 42vw"
                    priority
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/20" />
                <div className="absolute bottom-0 inset-x-0 p-6 md:p-8 text-white space-y-2">
                  <p className="inline-flex w-fit self-start text-[10px] uppercase tracking-[0.18em] font-bold text-primary bg-black px-2.5 py-1">
                    Featured
                  </p>
                  <h3 className="font-serif text-xl md:text-2xl tracking-[0.05em] drop-shadow-sm">
                    {featured.name}
                  </h3>
                  <p className="text-sm text-white/85">
                    £{featured.price?.toFixed(2)}
                    <span className="text-[9px] uppercase tracking-widest ml-2 text-white/60">
                      (Inc Vat)
                    </span>
                  </p>
                </div>
              </Link>
            )}

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-5 content-start">
              {rest.map((product) => (
                <ProductCard
                  key={product._id}
                  id={product._id}
                  name={product.name}
                  price={product.price}
                  image={getImage(product.images)}
                  images={product.images}
                  shopifyImages={product.shopifyImages}
                  category={product.category ?? ""}
                  categoryName={product.category ?? ""}
                  department={product.department}
                  brandName={product.brandName}
                  brandSlug={product.brandSlug}
                  priceMode={(product as any).specs?.priceDisplay || undefined}
                  pricePerM2={
                    Number((product as any).specs?.pricePerM2) > 0
                      ? Number((product as any).specs.pricePerM2)
                      : null
                  }
                  size={(product as any).specs?.size || undefined}
                  salePercent={
                    typeof (product as any).specs?.salePercent === "number"
                      ? (product as any).specs.salePercent
                      : null
                  }
                  vatRate={
                    (product as any).vatRate == null
                      ? 20
                      : Number((product as any).vatRate)
                  }
                  stock={product.stock}
                  shopifyVariantId={product.shopifyVariantId}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

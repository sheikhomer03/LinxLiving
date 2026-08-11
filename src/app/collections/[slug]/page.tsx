import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { getCollectionBySlug } from "@/app/actions/admin";
import { getProductDisplayImage } from "@/lib/productImage";
import { hasPaidSampleFlow } from "@/lib/priceOnRequest";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollectionBySlug(slug);
  if (!collection) return { title: "Collection Not Found" };

  return {
    title: `${collection.name} | Collection`,
    description:
      collection.description ||
      `Explore the ${collection.name} collection at Linx Square.`,
    alternates: { canonical: `/collections/${slug}` },
  };
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const collection = await getCollectionBySlug(slug);

  if (!collection) notFound();

  const products = (collection.products || []).filter(Boolean);

  return (
    <main className="min-h-screen bg-background">
      <StorefrontNavbar />
      <PageHeader
        title={collection.name}
        description={
          collection.description ||
          `A curated selection of ${products.length} product${products.length === 1 ? "" : "s"}.`
        }
        breadcrumb={[
          { label: "Collections", href: "/#shop" },
          { label: collection.name, href: `/collections/${slug}` },
        ]}
      />

      <section className="py-12 md:py-16 px-6 lg:px-20">
        <div className="max-w-[1600px] mx-auto">
          {products.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-10">
              {products.map((product: any) => (
                <ProductCard
                  key={product._id}
                  id={product._id}
                  name={product.name}
                  price={product.price}
                  image={getProductDisplayImage(product.images)}
                  images={product.images}
                  category={product.category}
                  categoryName={product.category}
                  department={product.department}
                  brandName={product.brand?.name || product.brandName}
                  brandSlug={product.brand?.slug || product.brandSlug}
                  priceMode={product.specs?.priceDisplay || undefined}
                  pricePerM2={
                    Number(product.specs?.pricePerM2) > 0
                      ? Number(product.specs.pricePerM2)
                      : null
                  }
                  size={product.specs?.size || undefined}
                  hasPaidSample={hasPaidSampleFlow(product.specs)}
                  salePercent={
                    typeof product.specs?.salePercent === "number"
                      ? product.specs.salePercent
                      : null
                  }
                  vatRate={
                    product.vatRate == null ? 20 : Number(product.vatRate)
                  }
                  stock={product.stock}
                  shopifyVariantId={product.shopifyVariantId}
                />
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-20 text-sm">
              This collection has no products yet.
            </p>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}

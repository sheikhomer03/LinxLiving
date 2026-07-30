import React from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProductDetailTabs } from "@/components/products/ProductDetailTabs";
import { ProductSection } from "@/components/products/ProductSection";
import { getPublicProduct, getPublicProducts } from "@/app/actions/products";
import { getApprovedProductReviews } from "@/app/actions/reviews";
import { getMenuBySlug, getBrandMenuTrees } from "@/app/actions/admin";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/products/ProductCard";
import { PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import { getProductDisplayImage, getProductGalleryImages } from "@/lib/productImage";
import { parseProductExtras } from "@/lib/productExtras";
import { pickMoreFromProducts } from "@/lib/moreFromProducts";
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

function pickSpec(specs: Record<string, unknown> | undefined, key: string) {
  if (!specs) return undefined;
  const direct = specs[key];
  if (direct != null && String(direct).trim()) return String(direct);
  const lower = Object.entries(specs).find(
    ([k]) => k.toLowerCase() === key.toLowerCase(),
  );
  if (lower?.[1] != null && String(lower[1]).trim()) return String(lower[1]);
  return undefined;
}

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

  const [
    category,
    subCategoryMenu,
    { products: trendingProducts },
    relatedBySub,
    relatedByCategory,
    storeName,
    brandRes,
    reviewData,
  ] = await Promise.all([
    getMenuBySlug(product.category),
    product.subCategory
      ? getMenuBySlug(product.subCategory)
      : Promise.resolve(null),
    getPublicProducts({
      limit: 8,
      sort: "newest",
      fields: "name price images category stock",
      skipCount: true,
    }),
    product.subCategory
      ? getPublicProducts({
          category: product.category,
          subCategory: product.subCategory,
          limit: 24,
          sort: "newest",
          fields:
            "name price images category stock shopifyVariantId specs.baseTitle brand",
          skipCount: true,
        })
      : Promise.resolve({ products: [] as any[] }),
    getPublicProducts({
      category: product.category,
      limit: 24,
      sort: "newest",
      fields:
        "name price images category stock shopifyVariantId specs.baseTitle brand",
      skipCount: true,
    }),
    getStoreName(),
    getBrandMenuTrees(),
    getApprovedProductReviews(id),
  ]);

  const brands = brandRes.brands || [];
  const productBrandId = product.brand
    ? String(
        typeof product.brand === "object" && product.brand !== null
          ? (product.brand as { _id?: string })._id || product.brand
          : product.brand,
      )
    : "";

  const menuTreeHasSlug = (nodes: any[] | undefined, slug: string): boolean => {
    if (!nodes?.length || !slug) return false;
    for (const node of nodes) {
      if (node.slug === slug) return true;
      if (menuTreeHasSlug(node.children, slug)) return true;
    }
    return false;
  };

  const matchedBrand =
    brands.find((b: any) => String(b._id) === productBrandId) ||
    brands.find(
      (b: any) =>
        menuTreeHasSlug(b.menus, product.category) ||
        menuTreeHasSlug(b.menus, product.subCategory),
    );

  const brandLabel = matchedBrand?.name || "Product";
  const relatedPool = [
    ...(relatedBySub.products || []),
    ...(relatedByCategory.products || []),
  ].map((p: any) => ({
    ...p,
    brandName: brandLabel,
  }));

  const moreFromProducts = pickMoreFromProducts(
    relatedPool,
    {
      id: product._id,
      name: product.name,
      baseTitle: pickSpec(
        (product.specs || {}) as Record<string, unknown>,
        "baseTitle",
      ),
    },
    3,
  );

  const specs = (product.specs || {}) as Record<string, unknown>;
  const saleRaw = pickSpec(specs, "salePercent");
  const salePercent =
    saleRaw != null && !Number.isNaN(Number(saleRaw))
      ? Number(saleRaw)
      : null;

  // Convert specs object to array format for UI.
  // Hide internal/meta keys used for filters & migrations.
  const HIDDEN_SPEC_KEYS = new Set([
    "sku",
    "source",
    "sourceId",
    "sourceid",
    "productCode",
    "productcode",
    "baseTitle",
    "basetitle",
    "salePercent",
    "salepercent",
    "spectraHandle",
    "spectraTitle",
    "matchScore",
  ]);
  const productSpecs = Object.entries(specs)
    .filter(
      ([label]) =>
        !HIDDEN_SPEC_KEYS.has(label) &&
        !HIDDEN_SPEC_KEYS.has(label.toLowerCase()),
    )
    .map(([label, value]) => ({
      label,
      value: String(value),
    }))
    .filter(
      (spec, index, arr) =>
        arr.findIndex(
          (s) => s.label === spec.label && s.value === spec.value,
        ) === index,
    );

  const images = getProductGalleryImages(product.images);

  const brandSlug = matchedBrand?.slug as string | undefined;
  const categoryHref = brandSlug
    ? `/category?brand=${encodeURIComponent(brandSlug)}&category=${encodeURIComponent(product.category)}`
    : `/category?category=${encodeURIComponent(product.category)}`;

  const extras = parseProductExtras({
    installationGuide: product.installationGuide,
    insulatingSetPrice: product.insulatingSetPrice,
    flashingFinder: product.flashingFinder,
    finishes: product.finishes,
    flashings: product.flashings,
  });

  // Linx Glass always shows an installation tip (DB guide or default measuring tip).
  const DEFAULT_MEASURING_TIP =
    "The external size is quoted as width × height. For a window listed as 550 × 980 mm, the 550 mm dimension is horizontal and the 980 mm dimension is vertical.\n\nLeave a 10 mm gap all the way around the opening for flashing and insulation — add 20 mm to each dimension when marking out the structural opening.";
  const installationGuideForTabs =
    extras.installationGuide ||
    (String(product.specs?.source || "") === "fakro-supabase"
      ? DEFAULT_MEASURING_TIP
      : null);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    ...(images.length ? { image: images } : {}),
    sku: pickSpec(specs, "sku") || product._id,
    brand: {
      "@type": "Brand",
      name: matchedBrand?.name || "Linx Square",
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
    <main className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <Navbar
        initialBrandMenus={brandRes.brands || []}
        initialStoreName={storeName}
      />

      <div className="pt-24 sm:pt-28 md:pt-36 lg:pt-40 pb-16 md:pb-20 px-4 md:px-6 lg:px-20 max-w-7xl mx-auto">
        <ProductSection
          product={{
            id: product._id,
            name: product.name,
            price: product.price,
            images,
            category: product.category,
            categoryName: category?.name || product.category,
            categoryHref,
            subCategory: product.subCategory || undefined,
            subCategoryName:
              subCategoryMenu?.name || product.subCategory || undefined,
            brandName: matchedBrand?.name,
            brandSlug,
            stock: product.stock ?? 0,
            shopifyVariantId: product.shopifyVariantId,
            sku: pickSpec(specs, "sku"),
            productCode: pickSpec(specs, "productCode"),
            size: pickSpec(specs, "size"),
            salePercent,
            averageRating: reviewData.average,
            reviewCount: reviewData.count,
            insulatingSetPrice: extras.insulatingSetPrice,
            finishes: extras.finishes,
            flashings: extras.flashings,
            moreFromProducts,
          }}
        />

        <div className="mt-14 md:mt-20">
          <ProductDetailTabs
            productId={product._id}
            description={product.description || ""}
            specs={productSpecs}
            showSpecs={product.showSpecs !== false}
            schematicImage={product.schematicImage || undefined}
            reviews={reviewData.reviews}
            averageRating={reviewData.average}
            reviewCount={reviewData.count}
            installationGuide={installationGuideForTabs}
            flashingFinder={extras.flashingFinder}
          />
        </div>
      </div>

      <section className="py-24 px-6 lg:px-20 border-t border-foreground/5 bg-secondary/5">
        <div className="flex flex-col items-center text-center mb-16 space-y-4">
          <p className="uppercase tracking-[0.4em] text-[10px] font-bold">
            Selection
          </p>
          <h2 className="text-3xl font-serif tracking-[0.2em] uppercase">
            What&apos;s Trending
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

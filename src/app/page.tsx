import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/home/Hero";
import { CategoryFeatureBands } from "@/components/home/CategoryFeatureBands";
import { TrustStrip } from "@/components/home/TrustStrip";
import { MaterialFamilies } from "@/components/home/MaterialFamilies";
import { ProjectGallery } from "@/components/home/ProjectGallery";
import { GuidanceAndCollections } from "@/components/home/GuidanceAndCollections";
import { BrandStory } from "@/components/home/BrandStory";
import { TrackOrderHome } from "@/components/home/TrackOrderHome";
import { ProductCard } from "@/components/products/ProductCard";
import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { getStoreName } from "@/app/actions/settings";
import { getPublicProducts } from "@/app/actions/products";
import { getFirstSubCategorySlug, getMenuTree } from "@/app/actions/admin";
import { getProductDisplayImage, getProductLifestyleImage } from "@/lib/productImage";
// import { NewsletterForm } from "@/components/home/NewsletterForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Linx Living | Home",
  description:
    "Curated collection of exquisite stone baths, fine ceramics, and luxury architectural tiles. Elevate your living spaces with Linx Living's master craftsmanship.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Linx Living | Home",
    description: "Exquisite stone baths and luxury tiles for refined living.",
    images: ["/images/hero-preview.jpg"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Linx Living",
  url: "https://linxliving.co.uk",
  description: "Boutique architectural materials and luxury surfaces.",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://linxliving.co.uk/search?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

export default async function Home() {
  const storeName = await getStoreName();
  const shopSlug = await getFirstSubCategorySlug();
  const shopLink = shopSlug ? `/category/${shopSlug}` : "/new-arrivals";

  const [{ products: dbProducts }, menuRes] = await Promise.all([
    getPublicProducts({
      limit: 24,
      sort: "newest",
      fields: "name price images category",
    }),
    getMenuTree(),
  ]);

  const topMenus = (menuRes.tree || []).slice(0, 3);
  const heroQuickLinks =
    topMenus.length > 0
      ? [
          ...topMenus.map((menu: any) => ({
            label: menu.name,
            href: `/category/${menu.slug}`,
          })),
          { label: "Bespoke projects", href: "/custom" },
        ]
      : undefined;
  const bandCopy = [
    "Finishes and fixtures selected for lasting interiors — specify with confidence.",
    "A considered edit of pieces that bring quiet detail to every room.",
    "Architectural materials ready for installation, from sample to site.",
  ];
  const categoryBands =
    topMenus.length > 0
      ? topMenus.map((menu: any, i: number) => ({
          eyebrow: i === 0 ? "Featured" : "Collection",
          title: menu.name,
          description: bandCopy[i % bandCopy.length],
          href: `/category/${menu.slug}`,
          cta: `Shop ${menu.name}`,
          image: menu.image || "",
          reverse: i % 2 === 1,
        }))
      : undefined;

  // All top-level (main) categories
  const mainCategories = (menuRes.tree || []).map((menu: any) => {
    const childCount = (menu.children || []).length;
    return {
      name: menu.name,
      tagline:
        childCount > 0
          ? `${childCount} subcategor${childCount === 1 ? "y" : "ies"}`
          : `Shop ${menu.name.toLowerCase()}`,
      href: `/category/${menu.slug}`,
      image: menu.image || "",
    };
  });

  // All subcategories with parent name for badge
  const materialFamilies = (menuRes.tree || []).flatMap((parent: any) =>
    (parent.children || []).map((child: any) => ({
      name: child.name,
      tagline: `In ${parent.name}`,
      href: `/category/${child.slug}`,
      image: child.image || "",
      parentName: parent.name,
    })),
  );

  // Prefer two catalogue products with real surface images (different categories when possible).
  // Spectra galleries end with the tile texture — skip branded packshots for the hero.
  const productsWithImages = (dbProducts || []).filter((p: any) =>
    Boolean(getProductDisplayImage(p.images)),
  );
  const heroPrimary = productsWithImages[0];
  const heroSecondary =
    productsWithImages.find(
      (p: any) =>
        p._id !== heroPrimary?._id && p.category !== heroPrimary?.category,
    ) || productsWithImages[1];
  const heroImages = [heroPrimary, heroSecondary]
    .filter(Boolean)
    .map((p: any) => ({
      src: getProductDisplayImage(p.images),
      alt: p.name,
      href: `/products/${p._id}`,
      caption: p.name,
    }));

  // Project gallery: 3 products with lifestyle/room shots when available
  const usedHeroIds = new Set(
    [heroPrimary?._id, heroSecondary?._id].filter(Boolean).map(String),
  );
  const projectCandidates = productsWithImages.filter(
    (p: any) => !usedHeroIds.has(String(p._id)),
  );
  const projectPool =
    projectCandidates.length >= 3 ? projectCandidates : productsWithImages;
  const projectItems = projectPool.slice(0, 3).map((p: any) => ({
    title: p.name,
    location: String(p.category || "Collection").replace(/-/g, " "),
    image: getProductLifestyleImage(p.images) || getProductDisplayImage(p.images),
    href: `/products/${p._id}`,
  }));

  // Dual promo banners — prefer lifestyle shots from other products
  const usedProjectIds = new Set(
    projectPool.slice(0, 3).map((p: any) => String(p._id)),
  );
  const guidancePool = productsWithImages.filter(
    (p: any) =>
      !usedHeroIds.has(String(p._id)) && !usedProjectIds.has(String(p._id)),
  );
  const guidanceSource =
    guidancePool.length >= 2
      ? guidancePool
      : productsWithImages.length >= 2
        ? productsWithImages
        : projectPool;
  const guidanceImages: [string?, string?] = [
    getProductLifestyleImage(guidanceSource[0]?.images) ||
      getProductDisplayImage(guidanceSource[0]?.images),
    getProductLifestyleImage(guidanceSource[1]?.images) ||
      getProductDisplayImage(guidanceSource[1]?.images),
  ];

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />

      {/* 1. Lusso cinematic hero */}
      <Hero
        storeName={storeName}
        initialShopLink={shopLink}
        quickLinks={heroQuickLinks}
        images={heroImages}
      />

      {/* 2. Main categories */}
      <MaterialFamilies
        items={mainCategories}
        eyebrow="Catalogue"
        title="Shop by category"
        description="Browse every main category in our catalogue — finishes, fixtures, and collections ready to explore."
        viewAllLabel="View all products"
        sectionId="categories"
        tone="muted"
      />

      {/* 3. Subcategories */}
      <MaterialFamilies
        items={materialFamilies}
        eyebrow="Collections"
        title="Shop by subcategory"
        description="Browse every subcategory in our catalogue — each card shows which parent category it belongs to."
        viewAllLabel="View all products"
        sectionId="collections"
        tone="plain"
      />

      {/* 4. New arrivals — product grid with prices & add-to-cart */}
      <section className="py-16 md:py-24 px-6 lg:px-20">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
            <div className="space-y-3 max-w-xl">
              <p className="uppercase tracking-[0.35em] text-[10px] font-bold text-primary">
                Just in
              </p>
              <h2 className="text-3xl md:text-4xl font-serif tracking-[0.08em]">
                New arrivals
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                The latest finishes and fixtures — ready for specification or
                immediate order.
              </p>
            </div>
            <Link
              href={shopLink}
              className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold border-b border-foreground/20 pb-1 hover:border-primary hover:text-primary transition-colors self-start md:self-auto shrink-0"
            >
              View all products
            </Link>
          </div>

          {dbProducts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-10">
              {dbProducts.slice(0, 8).map((product: any) => (
                <ProductCard
                  key={product._id}
                  id={product._id}
                  name={product.name}
                  price={product.price}
                  image={getProductDisplayImage(product.images)}
                  category={product.category}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-28 space-y-6 border border-dashed border-foreground/15">
              <PackageOpen className="w-14 h-14 stroke-1 opacity-40" />
              <div className="space-y-2 text-center">
                <h3 className="text-lg font-serif tracking-[0.2em] uppercase">
                  Collection expanding
                </h3>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  New architectural arrivals coming soon
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 5. USP strip — delivery, quality, showroom, support */}
      <TrustStrip storeName={storeName} />

      {/* 6. In-focus category spotlight */}
      <CategoryFeatureBands bands={categoryBands} />

      {/* 7. Project inspiration */}
      <ProjectGallery items={projectItems} />

      {/* 8. Track order CTA */}
      <TrackOrderHome />

      {/* 9. Dual promo banners — guides / collections */}
      <GuidanceAndCollections shopLink={shopLink} images={guidanceImages} />

      {/* 10. Brand story — dark anchor */}
      <BrandStory storeName={storeName} />

      {/* 11. Newsletter — moved to footer under Store
      <section className="py-24 md:py-32 px-6 lg:px-20 bg-secondary/60">
        <div className="max-w-xl mx-auto text-center space-y-5">
          <p className="uppercase tracking-[0.35em] text-[10px] font-bold text-primary">
            Newsletter
          </p>
          <h2 className="text-2xl md:text-3xl font-serif tracking-[0.14em]">
            Exclusive inspiration, curated for you
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Design inspiration, expert advice, and the latest product launches.
          </p>
          <NewsletterForm />
        </div>
      </section>
      */}

      <Footer />
    </main>
  );
}

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/home/Hero";
import { BrandShowcase } from "@/components/home/BrandShowcase";
import { CategoryExplorer } from "@/components/home/CategoryExplorer";
import { NewArrivalsSection } from "@/components/home/NewArrivalsSection";
import { CategoryFeatureBands } from "@/components/home/CategoryFeatureBands";
import { ProjectGallery } from "@/components/home/ProjectGallery";
import { GuidanceAndCollections } from "@/components/home/GuidanceAndCollections";
import { BrandStory } from "@/components/home/BrandStory";
import { TrackOrderHome } from "@/components/home/TrackOrderHome";
import { TrustStrip } from "@/components/home/TrustStrip";
import { getStoreName } from "@/app/actions/settings";
import { getPublicProducts } from "@/app/actions/products";
import {
  getFirstSubCategorySlug,
  getMenuTree,
  getBrandMenuTrees,
  getActiveCollections,
} from "@/app/actions/admin";
import { getProductDisplayImage, getProductLifestyleImage } from "@/lib/productImage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Linx Square | Home",
  description:
    "Curated collection of exquisite stone baths, fine ceramics, and luxury architectural tiles. Elevate your living spaces with Linx Square's master craftsmanship.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Linx Square | Home",
    description: "Exquisite stone baths and luxury tiles for refined living.",
    images: ["/images/hero-preview.jpg"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Linx Square",
  url: "https://linxliving.co.uk",
  description: "Boutique architectural materials and luxury surfaces.",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://linxliving.co.uk/search?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

export default async function Home() {
  const [
    storeName,
    shopSlug,
    { products: dbProducts },
    menuRes,
    brandRes,
    collectionRes,
  ] = await Promise.all([
    getStoreName(),
    getFirstSubCategorySlug(),
    getPublicProducts({
      limit: 24,
      sort: "newest",
      fields: "name price images category stock",
      skipCount: true,
    }),
    getMenuTree(),
    getBrandMenuTrees(),
    getActiveCollections(),
  ]);

  const shopLink = shopSlug ? `/category/${shopSlug}` : "/new-arrivals";

  const menuTree = menuRes.tree || [];
  const topMenus = menuTree.slice(0, 5);

  const heroQuickLinks = topMenus.map((menu: any) => ({
    label: menu.name,
    href: `/category/${menu.slug}`,
  }));

  const bandCopy = [
    "Finishes and fixtures selected for lasting interiors — specify with confidence.",
    "A considered edit of pieces that bring quiet detail to every room.",
    "Architectural materials ready for installation, from sample to site.",
  ];

  const categoryBands =
    topMenus.length > 0
      ? topMenus.slice(0, 3).map((menu: any, i: number) => ({
          eyebrow: i === 0 ? "Featured" : "Collection",
          title: menu.name,
          description: bandCopy[i % bandCopy.length],
          href: `/category/${menu.slug}`,
          cta: `Shop ${menu.name}`,
          image: menu.image || "",
          reverse: i % 2 === 1,
        }))
      : undefined;

  const mainCategories = menuTree.map((menu: any) => {
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

  const explorerCollections = (collectionRes.collections || []).map(
    (collection: any) => {
      const firstProduct = collection.products?.[0];
      const fallbackImage = firstProduct
        ? getProductDisplayImage(firstProduct.images)
        : "";
      const count = collection.products?.length || 0;

      return {
        name: collection.name,
        tagline:
          collection.description ||
          `${count} product${count === 1 ? "" : "s"} curated`,
        href: `/collections/${collection.slug}`,
        image: collection.image || fallbackImage || "",
        parentName: count > 0 ? `${count} items` : undefined,
      };
    },
  );

  const brandShowcase = (brandRes.brands || []).map((brand: any) => ({
    _id: brand._id,
    name: brand.name,
    slug: brand.slug,
    image: brand.image || "",
    menuCount: brand.menus?.length || 0,
    href: brand.menus?.[0]?.slug
      ? `/category/${brand.menus[0].slug}`
      : "/new-arrivals",
  }));

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
    image:
      getProductLifestyleImage(p.images) || getProductDisplayImage(p.images),
    href: `/products/${p._id}`,
  }));

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
      <Navbar
        initialBrandMenus={brandRes.brands || []}
        initialStoreName={storeName}
      />

      <Hero
        storeName={storeName}
        initialShopLink={shopLink}
        quickLinks={heroQuickLinks}
        images={heroImages}
      />

      <BrandShowcase brands={brandShowcase} storeName={storeName} />

      <CategoryExplorer
        categories={mainCategories}
        collections={explorerCollections}
        shopLink={shopLink}
      />

      <NewArrivalsSection
        products={dbProducts}
        shopLink={shopLink}
        getImage={getProductDisplayImage}
      />

      <CategoryFeatureBands bands={categoryBands} />

      <ProjectGallery items={projectItems} />

      <TrustStrip storeName={storeName} />

      <GuidanceAndCollections shopLink={shopLink} images={guidanceImages} />

      <TrackOrderHome />

      <BrandStory storeName={storeName} />

      <Footer initialStoreName={storeName} initialMenuTree={menuTree} />
    </main>
  );
}

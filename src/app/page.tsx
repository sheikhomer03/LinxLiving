import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import {
  ShopByDepartment,
  PopularSearches,
  BestSellingBands,
  LuxeReviewBar,
  LuxeReviews,
  type RangeBand,
} from "@/components/home/LuxeSections";
import { ProjectGallery } from "@/components/home/ProjectGallery";
import { TrackOrderHome } from "@/components/home/TrackOrderHome";
import { TrustStrip } from "@/components/home/TrustStrip";
import { getStoreName } from "@/app/actions/settings";
import {
  getPublicProducts,
  getHomeRangeBands,
} from "@/app/actions/products";
import { getMenuTree, getBrandMenuTrees } from "@/app/actions/admin";
import {
  getProductDisplayImage,
  getProductLifestyleImage,
  sanitizeDisplayImageUrl,
} from "@/lib/productImage";
import {
  LuxeHeroCarousel,
} from "@/components/home/LuxeCarousels";
import { buildHeroSlides } from "@/components/home/HeroBanners";
import { getCompanyReviews } from "@/lib/reviewsIo";
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
  const { getDepartmentTrees } = await import("@/app/actions/departments");
  const [
    storeName,
    { products: dbProducts },
    menuRes,
    brandRes,
    deptRes,
    rangeBandRes,
    reviewSummary,
  ] = await Promise.all([
    getStoreName(),
    getPublicProducts({
      limit: 24,
      sort: "newest",
      fields: "name price images category stock",
      skipCount: true,
    }),
    getMenuTree(),
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getHomeRangeBands(4),
    getCompanyReviews(12),
  ]);

  const rangeBands: RangeBand[] = rangeBandRes.bands || [];

  // Photography is curated in HeroBanners — see BANNER_SHOTS. The tile
  // from-price comes from the live range band so the banner cannot quote a
  // figure the catalogue no longer offers.
  const tilesBand = rangeBands.find((b) => b.slug === "tiles");
  const heroSlides = buildHeroSlides(undefined, {
    tilesFromPerSqm:
      tilesBand?.perSqm && tilesBand.fromPrice > 0
        ? tilesBand.fromPrice
        : undefined,
  });


  const menuTree = menuRes.tree || [];

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
    getProductDisplayImage(guidanceSource[1]?.images) ||
      getProductLifestyleImage(guidanceSource[1]?.images),
  ];
  // Avoid identical panels when lifestyle + display resolve to the same URL
  if (
    guidanceImages[0] &&
    guidanceImages[1] &&
    guidanceImages[0] === guidanceImages[1]
  ) {
    const alt =
      getProductLifestyleImage(guidanceSource[2]?.images) ||
      getProductDisplayImage(guidanceSource[2]?.images) ||
      getProductLifestyleImage(guidanceSource[1]?.images);
    if (alt && alt !== guidanceImages[0]) guidanceImages[1] = alt;
  }

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar
        initialBrandMenus={brandRes.brands || []}
        initialDepartments={deptRes.departments || []}
        initialStoreName={storeName}
      />

      {/* The navbar is `fixed`, so the page needs a spacer or the hero renders
          behind it. Height must match .page-top in globals.css — logo row (56)
          + service strip (48), plus the top bar (40) and department nav (46)
          from lg up. */}
      <div aria-hidden className="h-[104px] sm:h-[112px] lg:h-[192px]" />

      {/* FDF-style home: hero → department tiles → popular searches →
          best-selling rows → gallery / reviews / brands. */}
      <LuxeHeroCarousel slides={heroSlides} />

      <LuxeReviewBar summary={reviewSummary} />

      <ShopByDepartment bands={rangeBands} />

      <PopularSearches bands={rangeBands} />

      <BestSellingBands bands={rangeBands} />

      <ProjectGallery items={projectItems} />

      <LuxeReviews summary={reviewSummary} />

      <TrustStrip storeName={storeName} />

      <TrackOrderHome />

      <Footer initialStoreName={storeName} initialMenuTree={menuTree} />
    </main>
  );
}

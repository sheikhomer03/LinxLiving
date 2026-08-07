import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import {
  LuxePromiseBar,
  ShopByDepartment,
  PopularSearches,
  BestSellingBands,
  LuxeBrandRow,
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
  getStorefrontBrandCounts,
} from "@/app/actions/products";
import { getMenuTree, getBrandMenuTrees } from "@/app/actions/admin";
import {
  getProductDisplayImage,
  getProductLifestyleImage,
  sanitizeDisplayImageUrl,
} from "@/lib/productImage";
import {
  LuxeHeroCarousel,
  LuxeOfferSlider,
  VP_HERO_SLIDES,
  type OfferMessage,
} from "@/components/home/LuxeCarousels";
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
    brandCounts,
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
    getStorefrontBrandCounts(),
  ]);

  const rangeBands: RangeBand[] = rangeBandRes.bands || [];

  /** Cheapest per-m² rate across the area-sold ranges, for the hero proof point. */
  const heroFromPrice = rangeBands
    .filter((b) => b.perSqm && b.fromPrice > 0)
    .map((b) => b.fromPrice)
    .sort((a, b) => a - b)[0];

  /**
   * Offer strip messages.
   *
   * These are claims the site can actually stand behind — a live entry price,
   * the free sample service, the trade account and the review score. Add
   * genuine promotions (a discount code, a seasonal sale) here when there are
   * some to run; nothing invented sits in this list.
   */
  const heroOffers: OfferMessage[] = [
    heroFromPrice
      ? {
          text: `Tiles & flooring from £${heroFromPrice.toFixed(2)} per m²`,
          href: "/category?department=tiles",
          cta: "Shop tiles",
        }
      : null,
    {
      text: "Free samples — see the finish before you commit",
      href: "/category",
      cta: "Browse ranges",
    },
    {
      text: "Trade account: trade prices on every range",
      href: "/contact",
      cta: "Apply now",
    },
    reviewSummary.total
      ? {
          text: `Rated ${reviewSummary.average.toFixed(2)}/5 by ${reviewSummary.total} customers`,
          href: "/contact",
          cta: "Read reviews",
        }
      : null,
  ].filter(Boolean) as OfferMessage[];

  const menuTree = menuRes.tree || [];

  // Only brands with something to sell — the others would link to an empty
  // catalogue page.
  const brandShowcase = (brandRes.brands || [])
    .filter((brand: any) => (brandCounts[brand.slug] ?? 0) > 0)
    .map((brand: any) => ({
      _id: brand._id,
      name:
        String(brand.displayName || "").trim() ||
        String(brand.uiName || "").trim() ||
        brand.name,
      slug: brand.slug,
      image: sanitizeDisplayImageUrl(brand.image || ""),
      menuCount: brand.menus?.length || 0,
      productCount: brandCounts[brand.slug] ?? 0,
      href: `/category?brand=${encodeURIComponent(brand.slug)}`,
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

      {/* FDF-style home: hero → department tiles → popular searches →
          best-selling rows → gallery / reviews / brands. */}
      <LuxePromiseBar />

      <LuxeOfferSlider offers={heroOffers} />

      <LuxeHeroCarousel slides={VP_HERO_SLIDES} />

      <LuxeReviewBar summary={reviewSummary} />

      <ShopByDepartment bands={rangeBands} />

      <PopularSearches bands={rangeBands} />

      <BestSellingBands bands={rangeBands} />

      <ProjectGallery items={projectItems} />

      <LuxeReviews summary={reviewSummary} />

      <LuxeBrandRow brands={brandShowcase} />

      <TrustStrip storeName={storeName} />

      <TrackOrderHome />

      <Footer initialStoreName={storeName} initialMenuTree={menuTree} />
    </main>
  );
}

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
import { RealProjects } from "@/components/home/RealProjects";
import { TrackOrderHome } from "@/components/home/TrackOrderHome";
import { TrustStrip } from "@/components/home/TrustStrip";
import { getStoreName } from "@/app/actions/settings";
import {
  getCheapestInDepartment,
  getHomeInspirationProducts,
  getHomeNewArrivals,
  getHomeRangeBands,
} from "@/app/actions/products";
import { getBrandMenuTrees } from "@/app/actions/admin";
import {
  buildShopifyFallbackMap,
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

/**
 * A product's display image, from Shopify.
 *
 * The homepage borrows product photography for its hero, project and guidance
 * panels. Cloudinary is no longer displayed anywhere, so each of those has to
 * resolve through the product's Shopify pairing; a product the sync has not
 * mirrored yet contributes nothing and the panel falls back to the next
 * candidate.
 */
function shopifyImageFor(
  product: { images?: string[]; shopifyImages?: unknown } | null | undefined,
  pick: (images?: string[] | null) => string = getProductDisplayImage,
): string {
  if (!product) return "";
  const stored = pick(product.images);
  if (!stored) return "";
  return (
    buildShopifyFallbackMap(
      product.shopifyImages as Parameters<typeof buildShopifyFallbackMap>[0],
    )[stored] || ""
  );
}


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
    brandRes,
    deptRes,
    rangeBandRes,
    reviewSummary,
    cheapestTile,
    inspirationProducts,
  ] = await Promise.all([
    getStoreName(),
    getHomeNewArrivals(
      24,
      "name price images shopifyImages category department stock",
    ),
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getHomeRangeBands(4),
    getCompanyReviews(12),
    // Cheapest tile actually on sale — the hero quotes this figure.
    getCheapestInDepartment("tiles"),
    // "In real spaces" reads from staged range photography, not new arrivals.
    getHomeInspirationProducts(24),
  ]);

  const rangeBands: RangeBand[] = rangeBandRes.bands || [];

  // Photography is curated in HeroBanners — see BANNER_SHOTS.
  //
  // The from-price is read from the cheapest tile on sale. It used to come from
  // the range band, whose sample is sorted price-DESCENDING and capped, so the
  // "from" figure was the cheapest of the most expensive tiles — the banner
  // quoted £495 against a real entry price of £4.19.
  const cheapestTilePrice = Number(cheapestTile?.products?.[0]?.price) || 0;
  const heroSlides = buildHeroSlides(undefined, {
    tilesFromPerSqm: cheapestTilePrice > 0 ? cheapestTilePrice : undefined,
  });


  const productsWithImages = (dbProducts || []).filter((p: any) =>
    Boolean(shopifyImageFor(p)),
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
      src: shopifyImageFor(p),
      alt: p.name,
      href: `/products/${p._id}`,
      caption: p.name,
    }));

  const usedHeroIds = new Set(
    [heroPrimary?._id, heroSecondary?._id].filter(Boolean).map(String),
  );

  // "In real spaces" draws from the staged range photography
  // (getHomeInspirationProducts), not from new arrivals: the newest 24 are
  // whatever supplier imported last, which is how the section came to show
  // three RAK-INGOT niche crops. New arrivals remain the fallback if that pool
  // ever comes back empty.
  const inspirationWithImages = (inspirationProducts || []).filter((p: any) =>
    Boolean(shopifyImageFor(p, getProductLifestyleImage)),
  );
  const projectCandidates = (
    inspirationWithImages.length >= 3 ? inspirationWithImages : productsWithImages
  ).filter((p: any) => !usedHeroIds.has(String(p._id)));
  const projectPool =
    projectCandidates.length >= 3 ? projectCandidates : productsWithImages;

  // One card per category, topped up from whatever is left if three categories
  // are not available — otherwise a single range fills all three slots.
  const oneCardPerCategory = (pool: any[], count: number) => {
    const seen = new Set<string>();
    const first: any[] = [];
    const spare: any[] = [];
    for (const p of pool) {
      const key = String(p.category || p.department || p._id);
      if (seen.has(key)) spare.push(p);
      else {
        seen.add(key);
        first.push(p);
      }
    }
    return [...first, ...spare].slice(0, count);
  };
  const projectPicks = oneCardPerCategory(projectPool, 3);

  const projectItems = projectPicks.map((p: any) => ({
    title: p.name,
    location: String(p.category || "Collection").replace(/-/g, " "),
    image:
      shopifyImageFor(p, getProductLifestyleImage) || shopifyImageFor(p),
    href: `/products/${p._id}`,
  }));

  const usedProjectIds = new Set(
    projectPicks.map((p: any) => String(p._id)),
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
    shopifyImageFor(guidanceSource[0], getProductLifestyleImage) ||
      shopifyImageFor(guidanceSource[0]),
    shopifyImageFor(guidanceSource[1]) ||
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
      <div aria-hidden className="h-26 sm:h-28 lg:h-48" />

      {/* FDF-style home: hero → department tiles → popular searches →
          best-selling rows → gallery / reviews / brands. */}
      <LuxeHeroCarousel slides={heroSlides} />

      <LuxeReviewBar summary={reviewSummary} />

      <ShopByDepartment bands={rangeBands} />

      <PopularSearches bands={rangeBands} />

      <BestSellingBands bands={rangeBands} />

      <ProjectGallery items={projectItems} />

      <RealProjects />

      <LuxeReviews summary={reviewSummary} />

      <TrustStrip storeName={storeName} />

      <TrackOrderHome />

      <Footer initialStoreName={storeName} />
    </main>
  );
}

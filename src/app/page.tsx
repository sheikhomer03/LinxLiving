/* eslint-disable @typescript-eslint/no-explicit-any */
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
    menuRes,
    brandRes,
    deptRes,
    rangeBandRes,
    reviewSummary,
    cheapestTile,
  ] = await Promise.all([
    getStoreName(),
    getPublicProducts({
      limit: 24,
      sort: "newest",
      fields: "name price images shopifyImages category stock",
      skipCount: true,
    }),
    getMenuTree(),
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getHomeRangeBands(4),
    getCompanyReviews(12),
    // Cheapest tile actually on sale — the hero quotes this figure.
    getPublicProducts({
      department: "tiles",
      sort: "price-asc",
      limit: 1,
      fields: "price",
      skipCount: true,
    }),
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


  const menuTree = menuRes.tree || [];

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

  const projectCandidates = productsWithImages.filter(
    (p: any) => !usedHeroIds.has(String(p._id)),
  );
  const projectPool =
    projectCandidates.length >= 3 ? projectCandidates : productsWithImages;

  // Curated outdoor-living trio for the "In real spaces" section — picked by
  // hand rather than pulled from `projectPool` (newest-with-images), since
  // that pool surfaces plain product shots instead of installed/lifestyle
  // photography.
  const projectItems = [
    {
      title: "AlunoTec Palora P6 Frameless Sliding Glass Door",
      location: "Awning",
      image:
        "https://cdn.shopify.com/s/files/1/1053/8385/4344/files/palora-p6-4x10-sliding-glass-door-1_6e4469d0-26ee-4dbf-a9bb-d9ea6c1b2dfa.jpg?v=1787041243",
      href: "/products/6a804b22d9acfe1a3f52c19b",
    },
    {
      title: "AlunoTec Palora P6 Motorized Louvered Pergola",
      location: "Awning",
      image:
        "https://cdn.shopify.com/s/files/1/1053/8385/4344/files/palora-p6-4x6-motorized-wall-mounted-with-blade-and-gutter-lighting-1_0ba70e1f-5dc7-41ee-8687-411721a79396.jpg?v=1787041239",
      href: "/products/6a804b20d9acfe1a3f52c195",
    },
    {
      title: "Oscar Louvered Pergola — Type 220 (Heavy Duty)",
      location: "Pergola",
      image:
        "https://cdn.shopify.com/s/files/1/1053/8385/4344/files/catalog-10_2b30396d-82f7-4a21-9cb3-fe4ad1c7fc3d.jpg?v=1786715572",
      href: "/products/6a7f106d685a6234c38bee35",
    },
  ];

  const usedProjectIds = new Set([
    "6a804b22d9acfe1a3f52c19b",
    "6a804b20d9acfe1a3f52c195",
    "6a7f106d685a6234c38bee35",
  ]);
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

      <LuxeReviews summary={reviewSummary} />

      <TrustStrip storeName={storeName} />

      <TrackOrderHome />

      <Footer initialStoreName={storeName} initialMenuTree={menuTree} />
    </main>
  );
}

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { type RangeBand } from "@/components/home/LuxeSections";
import {
  ContactLine,
  EditorialText,
  FeatureBanner,
  FeatureDuo,
  type PanelContent,
} from "@/components/home/LussoSections";
import { getStoreName } from "@/app/actions/settings";
import {
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

/**
 * Curated room photography, by department slug.
 *
 * A panel is a full-bleed photograph with white copy over it, so it needs an
 * interior, not a product. Derived covers come from the catalogue and are as
 * often as not a cut-out on white — a boxed underfloor-heating kit, a rolled
 * carpet, a bath floating on grey — which is the wrong subject at this size and
 * gives the copy nothing to sit on. These are the staged interiors already in
 * the repo. Any department not listed still falls back to its catalogue cover.
 */
const CURATED_DEPARTMENT_SHOTS: Record<string, string> = {
  flooring: "/images/trade-account-hero.jpg",
  tiles: "/home/hero/kitchen-tiles.png",
  bathrooms: "/home/hero/bathroom-tiles.png",
  heating: "/home/hero/heating-flooring.png",
};

/**
 * Where a curated shot is aimed when the panel crops it.
 *
 * Only for photographs that are not centre-weighted. The heating still is a
 * composed image: the stove and the underfloor pipework are at its bottom-right
 * corner, and a centred crop in a 2:1 banner trims the pipework away along with
 * the top of the room. Anchoring it bottom-right keeps the two elements that
 * actually read as heating. Anything unlisted stays centred.
 */
const CURATED_DEPARTMENT_FOCUS: Record<string, string> = {
  heating: "right bottom",
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
    // "In real spaces" reads from staged range photography, not new arrivals.
    getHomeInspirationProducts(24),
  ]);

  const rangeBands: RangeBand[] = rangeBandRes.bands || [];


  const productsWithImages = (dbProducts || []).filter((p: any) =>
    Boolean(shopifyImageFor(p)),
  );

  const heroPrimary = productsWithImages[0];
  const heroSecondary =
    productsWithImages.find(
      (p: any) =>
        p._id !== heroPrimary?._id && p.category !== heroPrimary?.category,
    ) || productsWithImages[1];

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

  // projectPicks no longer renders a gallery of its own; it survives because
  // the guidance panels below exclude whatever it claimed, which is what stops
  // the same photograph appearing twice on the page.
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

  /*
   * NOTE ON COPY: this page's section *order and shape* deliberately mirror the
   * Lusso Stone homepage. The wording does not — every headline below is written
   * for this catalogue. CategoryFeatureBands and GuidanceAndCollections, which
   * an earlier draft used, still hold near-verbatim Lusso headlines ("Transform
   * your space", "Seamless luxury", "Expertly curated advice") in their default
   * props; they are no longer rendered here, but that copy is still in the repo
   * if either component is ever put back into service.
   */

  /**
   * A band's cover shot.
   *
   * `band.image` is a department field that is set on none of them, so it
   * falls back to a derived tile cover that only resolves for two departments
   * — filtering on it left the feature bands showing Tiles and Wall Panels
   * alone and the secondary grid empty. Every band carries its own sampled
   * products, so the band's first product with usable Shopify photography
   * stands in, which is the same resolution path the hero and project panels
   * already use.
   */
  const bandImage = (band: RangeBand): string => {
    const curated = CURATED_DEPARTMENT_SHOTS[band.slug];
    if (curated) return curated;
    const own = sanitizeDisplayImageUrl(band.image || "") || band.image || "";
    if (own) return own;
    // Two passes, not one. Taking `lifestyle || display` per product returns
    // the first product's cut-out even when a later product in the same band
    // has a room shot — and a cut-out on white is the wrong thing entirely
    // behind white overlaid copy. Every product is asked for a lifestyle shot
    // before any is asked for a display shot.
    for (const p of band.products || []) {
      const img = shopifyImageFor(p, getProductLifestyleImage);
      if (img) return img;
    }
    for (const p of band.products || []) {
      const img = shopifyImageFor(p);
      if (img) return img;
    }
    return "";
  };

  const bandsWithCover = rangeBands
    .map((b) => ({ band: b, image: bandImage(b) }))
    .filter((entry) => Boolean(entry.image));

  /**
   * The stacked category blocks read from the live range bands rather than the
   * component's bundled /images/tiles*.jpg placeholders, so the blocks show
   * departments that actually have stock and lead with real photography.
   */
  const priceSuffix = (b: RangeBand) =>
    `£${b.fromPrice.toFixed(2)}${b.perSqm ? " per m²" : ""}`;

  /**
   * One panel's worth of content per department, in department order.
   *
   * The page consumes these positionally — panels[0] is the hero banner,
   * [1]/[2] the first pair, [3] the second banner, [4]/[5] the closing pair —
   * so a department never appears twice.
   */
  const panels: PanelContent[] = bandsWithCover.map(({ band, image }) => ({
    eyebrow: band.perSqm ? "Per m²" : "Collection",
    title: band.name,
    body: band.fromPrice
      ? `Explore the ${band.name.toLowerCase()} range, from ${priceSuffix(band)}`
      : `Explore the ${band.name.toLowerCase()} range`,
    image,
    imagePosition: CURATED_DEPARTMENT_FOCUS[band.slug],
    ctas: [
      {
        label: `Shop ${band.name.toLowerCase()}`,
        href: `/category?department=${encodeURIComponent(band.slug)}`,
      },
    ],
  }));

  /*
   * Heating takes the full-width slot.
   *
   * The page consumes `panels` positionally, and index 2 is the only one that
   * renders 100vw wide; indices 0/1 and 3/4 are half-width panels, which at
   * desktop are 720x720 squares. Every still here is 3:2, so a square panel
   * crops about a third off each side — fine for the room shots, whose subject
   * sits in the middle, and wrong for the heating photograph, which carries the
   * radiator at its left edge and the stove and underfloor pipework at its
   * right. Cropped to its middle it shows a dining table and loses every cue
   * that it is about heating.
   *
   * Wall panels takes the vacated half-width slot: its cover is a centred
   * dining table against a panelled wall, which survives the square crop.
   */
  const BANNER_SLOT = 2;
  const heatingIndex = panels.findIndex((p) => p.title?.toLowerCase() === "heating");
  if (heatingIndex > BANNER_SLOT) {
    const [heatingPanel] = panels.splice(heatingIndex, 1);
    panels.splice(BANNER_SLOT, 0, heatingPanel);
  }

  /**
   * Backdrops for the two panels whose subject is the range itself rather than
   * a department. Lusso runs stills in every one of its sections — the DOM has
   * no <video> outside the hero — so these take department photography rather
   * than the showroom films, which now appear only in the hero.
   *
   * Departments 0–4 hold the five department slots, so the spare covers start
   * after those; guidance imagery is the fallback when the catalogue is thin.
   */
  const DEPARTMENT_SLOTS = 5;
  const spareCovers = panels
    .slice(DEPARTMENT_SLOTS)
    .map((p) => p.image)
    .filter((src): src is string => Boolean(src));

  const trustImage = spareCovers[0] || guidanceImages[0] || panels[0]?.image;
  const tradeImage =
    spareCovers[1] || guidanceImages[1] || panels[1]?.image;

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* `overlay` is the Lusso treatment: the header sits transparent on the
          film below, in white ink over a gradient scrim, and goes solid on
          hover or once you scroll past it. It is opt-in per page because it
          only works where there is imagery behind the header — every other
          route keeps the same grid on a white ground. */}
      <Navbar
        initialBrandMenus={brandRes.brands || []}
        initialDepartments={deptRes.departments || []}
        initialStoreName={storeName}
        overlay
      />

      {/* No spacer. The header overlays the hero rather than sitting above
          it, which is what Lusso's negative `#MainContent` margin achieves.
          Interior pages still clear the header with `.page-top`. */}

      {/*
        Lusso Stone homepage structure, block for block:
          banner → duo → banner → duo → banner → duo → editorial → contact
        Nothing else sits between the navbar and the footer on that page — no
        search field, no product rows, no department tiles, no reviews. The
        photography carries the whole page, so this one does the same.
      */}

      {/* 1 — hero. Lusso runs a still here; this one runs the showroom film at
          the client's request. Served from /public rather than Cloudinary so
          the first paint does not wait on a third-party host. */}
      <FeatureBanner
        content={{
          // Distinct from the editorial heading further down, which keeps the
          // category-list title the way Lusso's closing text block does.
          eyebrow: storeName,
          title: "Step inside the showroom",
          body: "Flooring, tiles, wall panels, bathrooms and heating — specified, priced and delivered from one supplier",
          video: "/home/real-projects/virtual-showroom-tour.mp4",
          poster: "/home/hero/bathroom-tiles.png",
          ctas: [{ label: "Shop all departments", href: "/category" }],
        }}
        tall
        priority
      />

      {/* 2 — two half-width panels. */}
      {panels[0] && panels[1] ? (
        <FeatureDuo left={panels[0]} right={panels[1]} />
      ) : null}

      {/* 3 — brand/trust banner. Uses a film where one is available, which is
          where the showroom footage earns its place now that the standalone
          films section is gone. */}
      <FeatureBanner
        content={{
          eyebrow: "Stocked at " + storeName,
          title: "The brands behind the range",
          body: "Ceramics, surfaces and fittings from the manufacturers specified on projects across the UK",
          image: trustImage,
          ctas: [{ label: "Read more", href: "/about" }],
        }}
      />

      {/* 4 — guides and collections. */}
      <FeatureDuo
        left={{
          eyebrow: "Expert guidance",
          title: "Find the right specification",
          body: "Sizes, finishes, coverage and lead times — the detail that decides a range",
          image: "/home/hero/wood-flooring.png",
          ctas: [{ label: "Read the guides", href: "/faq" }],
        }}
        right={{
          // Not "Collections": that table holds three rows, two of them test
          // records, so the card had nowhere real to send anyone. Trade sits
          // naturally beside the guidance card — both are pre-purchase help
          // rather than a department.
          eyebrow: "Trade account",
          title: "Trade pricing on every range",
          body: "Project pricing, dedicated support and priority lead times for trade customers",
          image: tradeImage,
          ctas: [{ label: "Open a trade account", href: "/trade" }],
        }}
      />

      {/* 5 — banner with two CTAs, as Lusso's baths block carries. */}
      {panels[2] ? (
        <FeatureBanner
          content={{
            ...panels[2],
            ctas: [
              ...(panels[2].ctas ?? []),
              { label: "View all departments", href: "/category" },
            ],
          }}
        />
      ) : null}

      {/* 6 — final pair. */}
      {panels[3] && panels[4] ? (
        <FeatureDuo left={panels[3]} right={panels[4]} />
      ) : null}

      {/* 7 — editorial text. */}
      <EditorialText
        title={`Luxury bathrooms, tiles & surfaces`}
        paragraphs={[
          `${storeName} supplies flooring, tiles, wall panels, bathrooms and heating for residential and commercial projects, bringing together ranges from the manufacturers specified across the UK.`,
          `The catalogue spans large-format porcelain and natural stone, engineered and luxury vinyl flooring, sanitaryware, brassware and underfloor heating — held together by a single point of contact for pricing, samples and lead times.`,
          `Trade accounts, free samples and delivery across the UK mainland are available on every range.`,
        ]}
      />

      {/* 8 — contact. */}
      <ContactLine phone="020 4634 2203" email="info@linxsquare.co.uk" />

      <Footer initialStoreName={storeName} />
    </main>
  );
}

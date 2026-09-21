/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import Image from "next/image";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProductDetailTabs } from "@/components/products/ProductDetailTabs";
import { ProductSupplierSections } from "@/components/products/ProductSupplierSections";
import { ProductFeaturePacking } from "@/components/products/ProductFeaturePacking";
import { ProductFilesDocumentation } from "@/components/products/ProductFilesDocumentation";
import { ProductDownloads } from "@/components/products/ProductDownloads";
import { ProductAddOns } from "@/components/products/ProductAddOns";
import { RecentlyViewed } from "@/components/products/RecentlyViewed";
import { ProductUsageExplore } from "@/components/products/ProductUsageExplore";
import { ProductSection } from "@/components/products/ProductSection";
import { getSupportContact } from "@/lib/support";
import {
  getPublicProduct,
  getPublicProducts,
  getRelatedListing,
} from "@/app/actions/products";
import { getApprovedProductReviews } from "@/app/actions/reviews";
import { getMenuBySlug, getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { notFound } from "next/navigation";
import { ProductReviewsPanel } from "@/components/products/ProductReviews";
import {
  ProductCarousel,
  type CarouselProduct,
} from "@/components/products/ProductCarousel";
import type { Metadata } from "next";
import {
  resolveGalleryImages,
  cdnImageUrl,
  getProductDisplayImage,
  getProductGalleryImages,
  withShopifyOptionImages,
} from "@/lib/productImage";
import { hasPaidSampleFlow } from "@/lib/priceOnRequest";
import { parseProductExtras } from "@/lib/productExtras";
import { parseProductSections } from "@/lib/productSections";
import { resolveAddonProducts, resolveSwatchGroups } from "@/lib/swatchGroups";
import { pickMoreFromProducts, pickSizeOptions } from "@/lib/moreFromProducts";
import { formatDisplaySize } from "@/lib/sizeBuckets";
import {
  BadgePercent,
  CalendarDays,
  CreditCard,
  PackageOpen,
  PhoneCall,
} from "lucide-react";
import { getStoreName } from "@/app/actions/settings";
import { departmentMenuImage } from "@/lib/departmentImages";

/**
 * Cache the rendered product page for 60 seconds (ISR).
 * After the first request, Next.js serves the cached HTML for all visitors
 * until it expires — no DB round-trip for every single page load.
 * The `products` tag means admin product edits can bust this instantly via
 * revalidateTag("products").
 */
export const revalidate = 60;

/**
 * The photograph the page closes on, under the contact panel.
 *
 * Only reached when the product's department has no picture of its own —
 * see `departmentMenuImage`, which prefers an admin upload, then the staged
 * interior for that department, then a shot from its own stock.
 */
const CLOSING_BANNER_FALLBACK = "/home/hero/heated-bathroom.webp";

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

  /*
   * The share card takes the same picture the page does.
   *
   * It used to point at the stored image as the supplier shipped it, so a
   * Spectra link pasted into WhatsApp previewed with the supplier's logo band
   * across the top — the band the site crops off everywhere a customer can see
   * it. Resolving through the Shopify pairing applies that crop (see
   * buildShopifyFallbackMap), and Shopify is the only host the site displays
   * from now. `cdnImageUrl` then asks for it at share-card size rather than
   * handing the scraper the full-resolution original.
   *
   * A product the sync has not mirrored keeps the stored URL, which is what
   * shipped before this; only then does the generic card stand in.
   */
  const mirroredImage = getProductDisplayImage(resolveGalleryImages(product));
  const shareImage = mirroredImage
    ? cdnImageUrl(mirroredImage, 600)
    : "/images/og-image.jpg";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [shareImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [shareImage],
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

  // Kick off all data fetches in parallel — product, nav, reviews, support
  // all start at the same time so nothing blocks anything else.
  const storeNamePromise = getStoreName();
  const brandPromise = getBrandMenuTrees();
  const deptPromise = getDepartmentTrees();
  const reviewPromise = getApprovedProductReviews(id);
  const supportPromise = getSupportContact();
  const productPromise = getPublicProduct(id);

  // Await support + product together — both were sequential before, now
  // they overlap with every other fetch above.
  const [support, loadedProduct] = await Promise.all([
    supportPromise,
    productPromise,
  ]);
  // Rewrites every option and variant image to its Shopify copy before the
  // page is built, so the pickers, swatches and spec tabs all render from
  // Shopify without each of them having to know about the pairing.
  // Rewritten only when there is a product: spreading null would produce an
  // empty object, which is truthy, and the not-found branch below would never
  // fire.
  const product = loadedProduct
    ? (withShopifyOptionImages(loadedProduct as Record<string, unknown>) as any)
    : loadedProduct;

  if (!product) {
    notFound();
  }

  // "More Suggestions" needs whichever of `category` / `subCategory` is
  // this product's genuine narrow grouping — which one that is varies by
  // department. Tiles keep it in `category` (e.g. "gloss",
  // "signature-collection" — see /category?department=tiles&category=gloss),
  // while Bathrooms/Accessories often set `category` to the same slug as
  // `department` and only carry the real grouping in `subCategory` (e.g.
  // "wetroom-shower-screens", "copper-brass-pipe-fittings" — see
  // /category?department=accessories&subcategory=copper-brass-pipe-fittings).
  // So: prefer `category` only when it actually differs from `department`,
  // else prefer `subCategory`, else fall back to whatever is set.
  const moreFromFilter =
    product.category && product.category !== product.department
      ? { category: product.category }
      : product.subCategory
        ? { subCategory: product.subCategory }
        : product.category
          ? { category: product.category }
          : { department: product.department };

  const [
    category,
    subCategoryMenu,
    relatedByCategory,
    relatedByCategoryOnly,
    storeName,
    brandRes,
    deptRes,
    reviewData,
  ] = await Promise.all([
    getMenuBySlug(product.category),
    product.subCategory
      ? getMenuBySlug(product.subCategory)
      : Promise.resolve(null),
    getRelatedListing({
      // "What's Trending" should surface top items from this product's whole
      // department (e.g. Bathrooms), not just its narrow category (e.g.
      // Wetroom Shower Screens) — falls back to category only for the rare
      // product with no department tag.
      ...(product.department
        ? { department: product.department }
        : { category: product.category }),
      limit: 40,
      // "What's Trending" reuses this same department-scoped read below, so
      // the field list also carries what ProductCard needs for discount
      // (specs.salePercent), price-per-m2 mode and the free-sample tag
      // (hasPaidSampleFlow reads specs.samplePrice/source/ottoId/ottoHandle).
      fields:
        "name price images shopifyImages category department stock shopifyVariantId vatRate specs.baseTitle specs.spectraTitle specs.size specs.Size specs.salePercent specs.priceDisplay specs.pricePerM2 specs.samplePrice specs.source specs.ottoId specs.ottoHandle brand",
    }),
    // "More Suggestions" must stay within this product's own category/
    // subcategory grouping, not widen to the whole department like
    // "What's Trending" above — see moreFromFilter above for which field.
    // Explicit price-asc also opts this one query out of getPublicProducts'
    // default "lead with the 12 highest-priced matches" merchandising sort.
    getRelatedListing({
      ...moreFromFilter,
      sort: "price-asc",
      limit: 40,
      fields:
        "name price images shopifyImages category subCategory department stock shopifyVariantId vatRate specs.baseTitle specs.spectraTitle specs.size specs.Size specs.salePercent specs.salePriceMode specs.priceDisplay specs.pricePerM2 specs.samplePrice specs.source specs.ottoId specs.ottoHandle specs.compareAtPrice specs.shopifyCompareAt brand",
    }),
    storeNamePromise,
    brandPromise,
    deptPromise,
    reviewPromise,
  ]);

  const brands = brandRes.brands || [];
  const productBrandId = product.brand
    ? String(
        typeof product.brand === "object" && product.brand !== null
          ? (product.brand as { _id?: string })._id || product.brand
          : product.brand,
      )
    : "";

  const matchedBrand =
    brands.find((b: any) => String(b._id) === productBrandId) || null;

  // Never fall back to "whichever brand owns this category menu" — that made
  // Sterlingbuild / other-brand SKUs appear as "by FAKRO".
  const brandLabel =
    String(matchedBrand?.displayName || "").trim() ||
    String(matchedBrand?.uiName || "").trim() ||
    matchedBrand?.name ||
    "";
  const brandSlug = matchedBrand?.slug as string | undefined;
  const relatedPool = (relatedByCategory.products || []).map((p: any) => ({
    ...p,
    brandName: brandLabel,
    brandSlug,
  }));
  const moreFromPool = (relatedByCategoryOnly.products || []).map(
    (p: any) => ({
      ...p,
      brandName: brandLabel,
      brandSlug,
    }),
  );

  const moreFromProducts = pickMoreFromProducts(
    moreFromPool,
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

  /**
   * The two product strips under the accordions.
   *
   * The reference runs three — Frequently Bought Together, You May Also
   * Like, Complete The Look. The first of those is this page's curated
   * add-ons block, which already sits under the gallery, so these are the
   * other two, drawn from the pools already fetched above rather than from
   * two more round trips:
   *
   *   You may also like   the department pool, same shape as the grid it
   *                       replaces
   *   Complete the look   the category/subcategory pool, minus the three
   *                       already shown as "More suggestions" beside the buy
   *                       card, so no product appears twice on the page
   */
  const toCarouselProduct = (p: any): CarouselProduct => {
    const brandId = p.brand
      ? String(typeof p.brand === "object" ? p.brand._id || p.brand : p.brand)
      : "";
    const brand = brandId
      ? brands.find((b: any) => String(b._id) === brandId)
      : null;
    return {
      _id: String(p._id),
      name: p.name,
      price: p.price,
      images: p.images,
      shopifyImages: p.shopifyImages,
      category: p.category,
      department: p.department,
      stock: p.stock,
      shopifyVariantId: p.shopifyVariantId,
      vatRate: p.vatRate,
      specs: p.specs || {},
      brandName: brand?.name,
      brandSlug: brand?.slug,
      hasPaidSample: hasPaidSampleFlow(p.specs),
    };
  };

  /*
   * Filled in order, against one running set of ids, so the three strips
   * never repeat a product between them — the category pool and the
   * department pool overlap heavily, and without this the same tile appeared
   * in two of them.
   */
  const usedCarouselIds = new Set<string>([String(product._id)]);
  const takeCarousel = (pool: any[], count: number): CarouselProduct[] => {
    const picked: CarouselProduct[] = [];
    for (const candidate of pool) {
      const id = String(candidate?._id || "");
      if (!id || usedCarouselIds.has(id)) continue;
      usedCarouselIds.add(id);
      picked.push(toCarouselProduct(candidate));
      if (picked.length >= count) break;
    }
    return picked;
  };

  // Slot order and sizes follow the reference; only the first strip's
  // heading differs. Theirs reads "Frequently bought together", which is a
  // claim about what people buy together — we do not measure that, so ours
  // says what it actually is.
  const moreSuggestionProducts = takeCarousel(moreFromPool, 8);
  const alsoLikeProducts = takeCarousel(relatedPool, 8);
  const completeTheLookProducts = takeCarousel(relatedPool, 8);

  const specs = (product.specs || {}) as Record<string, unknown>;
  const productSize = pickSpec(specs, "size");
  const sizeOptions = pickSizeOptions(relatedPool, {
    id: product._id,
    name: product.name,
    price: product.price,
    size: productSize,
    baseTitle: pickSpec(specs, "baseTitle"),
    spectraTitle: pickSpec(specs, "spectraTitle"),
  });
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
    "galleryrefreshedat",
    "porcelanosacode",
    "tipoproducto",
    "sourceurl",
    "serie",
    "naturahandle",
    "naturaid",
    "naturacollections",
    "sizeWeightTable",
    "sizeweighttable",
    // Import bookkeeping and calculator plumbing: `specs` is the verbatim
    // record of what a supplier published, so these live there too, but they
    // are machinery rather than something a customer reads off a spec table.
    "sourcevendor",
    "sourceproducttype",
    "sourcecollections",
    "sourcepaths",
    "importedat",
    "sqmperbox",
    "priceperm2",
    "pricepersqm",
  ]);
  const isPorcelanosa =
    brandSlug === "porcelanosagrupo" ||
    String(pickSpec(specs, "source") || "") === "porcelanosa-scrape";
  let featureEntries = Array.isArray((product as any).featureEntries)
    ? (product as any).featureEntries
        .map((row: any) => ({
          label: String(row?.label || "").trim(),
          value: String(row?.value || "").trim(),
        }))
        .filter((row: { label: string; value: string }) => row.label && row.value)
    : [];
  // Until refresh finishes, Porcelanosa Features can still come from scraped specs.
  if (!featureEntries.length && isPorcelanosa) {
    const META = new Set([
      "sku",
      "source",
      "sourceurl",
      "productcode",
      "porcelanosacode",
      "tipoproducto",
      "serie",
      "galleryrefreshedat",
    ]);
    featureEntries = Object.entries(specs)
      .filter(
        ([k, v]) =>
          !META.has(k.toLowerCase()) &&
          String(v || "").trim() &&
          String(v).toUpperCase() !== "-" &&
          String(v).toUpperCase() !== "NO APLICA",
      )
      .map(([label, value]) => ({
      label,
      value: String(value),
      }));
  }
  const packingEntries = Array.isArray((product as any).packingEntries)
    ? (product as any).packingEntries
        .map((row: any) => ({
          label: String(row?.label || "").trim(),
          value: String(row?.value || "").trim(),
        }))
        .filter((row: { label: string; value: string }) => row.label && row.value)
    : [];
  const { parseColorOptions } = await import("@/lib/productColors");
  const colorOptions = parseColorOptions((product as any).colorOptions);
  const { parseSizeOptions } = await import("@/lib/productSizes");
  const productSizes = parseSizeOptions((product as any).sizeOptions);
  const {
    parsePookyBases,
    parsePookyShades,
    parsePookyPendants,
    parsePookyWallFittings,
    parsePookyEfficiency,
  } = await import("@/lib/productPookySections");
  const bases = parsePookyBases((product as any).bases);
  const shades = parsePookyShades((product as any).shades);
  const pendants = parsePookyPendants((product as any).pendants);
  const wallFittings = parsePookyWallFittings((product as any).wallFittings);
  const efficiency = parsePookyEfficiency((product as any).efficiency);
  const {
    parseCoverage,
    parseOptionFields,
    parseDoTheJobRight,
    parseShopifyOptions,
    parseUfhsVariants,
    parseOptionInfo,
    parseOptionElements,
  } = await import("@/lib/productUfhsSections");
  const optionInfo = parseOptionInfo((product as any).optionInfo);
  const optionElements = parseOptionElements((product as any).optionElements);
  const coverage = parseCoverage((product as any).coverage);
  const nestedOptions = parseOptionFields((product as any).nestedOptions);
  const doTheJobRight = parseDoTheJobRight((product as any).doTheJobRight);
  const shopifyOptions = parseShopifyOptions((product as any).shopifyOptions);
  const ufhsVariants = (() => {
    const fromField = parseUfhsVariants((product as any).variants);
    if (fromField.length) return fromField;
    return parseUfhsVariants((product as any).specs?.ufhsVariants);
  })();
  const { parseProductDownloads } = await import("@/lib/productDownloads");
  const downloads = parseProductDownloads((product as any).downloads);
  const { parseFilesDocumentation } = await import(
    "@/lib/productFilesDocumentation"
  );
  let filesDocumentation = parseFilesDocumentation(
    (product as any).filesDocumentation,
  );
  // Legacy Porcelanosa scrape stored docs in `downloads` — map into Files and
  // Documentation so they don't appear under the Downloads accordion.
  let downloadsForPdp = downloads;
  if (!filesDocumentation.length && isPorcelanosa && downloads.length) {
    filesDocumentation = [
      {
        heading: "DOCUMENTS",
        files: downloads
          .map((d) => ({
            title: d.title,
            url: d.url || d.children?.[0]?.url || "",
            type: (d.type === "pdf" ? "pdf" : "other") as
              | "pdf"
              | "zip"
              | "other",
          }))
          .filter((f) => f.title && f.url),
      },
    ].filter((s) => s.files.length);
    downloadsForPdp = [];
  } else if (isPorcelanosa) {
    // Porcelanosa docs belong in Files and Documentation only.
    downloadsForPdp = [];
  }
  const legalDisclaimer =
    String((product as any).legalDisclaimer || "").trim() ||
    (isPorcelanosa
      ? "All details provided by the PORCELANOSA Group's Product Finder has an information purpose without any contractual value. In order to obtain further information about the materials and their installation please visit our showrooms. PORCELANOSA Group reserves the right to modify or delete any information on this site. The images and colours shown in this site may differ from the real ones."
      : "");
  // When Features are stored separately, don't duplicate those keys in Technical Specs.
  const featureLabels = new Set(
    featureEntries.map((r: { label: string }) => r.label.toLowerCase()),
  );
  const productSpecs = Object.entries(specs)
    .filter(
      ([label]) =>
        !HIDDEN_SPEC_KEYS.has(label) &&
        !HIDDEN_SPEC_KEYS.has(label.toLowerCase()) &&
        !featureLabels.has(label.toLowerCase()),
    )
    .map(([label, value]) => {
      const text = String(value);
      if (/^size$/i.test(label)) {
        return { label: "Available size", value: formatDisplaySize(text) || text };
      }
      return { label, value: text };
    })
    .filter(
      (spec, index, arr) =>
        arr.findIndex(
          (s) =>
            s.label.toLowerCase() === spec.label.toLowerCase() &&
            s.value === spec.value,
        ) === index,
    );

  /**
   * Supplier dimension / attribute rows lead the spec table, in the order the
   * supplier lists them, with the generic spec keys following.
   */
  const supplierRows = [
    ...(Array.isArray((product as any).dimensionRows)
      ? (product as any).dimensionRows
      : []),
    ...(Array.isArray((product as any).attributes)
      ? (product as any).attributes
      : []),
  ]
    .map((row: { label?: string; value?: string }) => ({
      label: String(row?.label || "").trim(),
      value: String(row?.value || "").trim(),
    }))
    .filter((row) => row.label && row.value);

  const supplierLabels = new Set(supplierRows.map((r) => r.label.toLowerCase()));
  const combinedSpecs = [
    ...supplierRows,
    ...productSpecs.filter((s) => !supplierLabels.has(s.label.toLowerCase())),
  ].filter(
    (spec, index, arr) =>
      arr.findIndex((s) => s.label.toLowerCase() === spec.label.toLowerCase()) ===
      index,
  );

  /**
   * A pergola's price grid is a table, not a list of key/value specs: each
   * plan size fixes its motor and post count and then carries a price per roof
   * configuration. It renders through the same spec table the size/weight
   * sheets use, so no new surface was needed on the detail page.
   */
  const pergolaRows = Array.isArray((product as any).pergolaSizeRows)
    ? (product as any).pergolaSizeRows
    : [];
  const pergolaTable = pergolaRows.length
    ? {
        caption: "Standard sizes, motors and prices",
        headings: [
          "Size",
          "Motor (set)",
          "Post (pcs)",
          "Height",
          "Manual (No LED)",
          "Electric Roof (With LED)",
          "Electric Roof With 4 Sides Roller Blinds",
        ],
        rows: pergolaRows.map((row: Record<string, unknown>) => {
          const money = (v: unknown) =>
            Number.isFinite(Number(v)) && Number(v) > 0
              ? `£${Number(v).toLocaleString("en-GB", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : "—";
          return [
            String(row.size ?? ""),
            String(row.motorSet ?? ""),
            row.postPcs != null ? String(row.postPcs) : "",
            row.heightM != null ? `${row.heightM} m` : "",
            money(row.manualNoLedPrice),
            money(row.electricLedPrice),
            money(row.electricLedBlindsPrice),
          ];
        }),
      }
    : null;

  const supplierRating = (product as any).reviewSummary || null;

  // Finishes sold as separate products (Plank Hardware), resolved to our pages.
  const swatchGroups = await resolveSwatchGroups(
    (product as any).swatchGroups,
    String(product._id),
  );
  /**
   * Supplier accordions live under the buy box, next to "Need help with this
   * product?" — Description and Specifications are already their own panels.
   */
  const supplierSections = parseProductSections(
    (product as any).productSections,
  );

  /*
   * Delivery and returns, from this shop's rules rather than the supplier's.
   *
   * `lib/shipping` is what the checkout charges, so the panel and the bill
   * cannot disagree, and changing a rate changes both at once. The scraped
   * suppliers' own panels are filtered out in `parseProductSections`.
   */
  const { FREE_DELIVERY_THRESHOLD, STANDARD_DELIVERY, TILE_FLOORING_DELIVERY, STANDARD_ITEM_DELIVERY } =
    await import("@/lib/shipping");
  const deliverySection = {
    heading: "Delivery & Returns",
    text:
      "Returns are accepted within 14 days of receipt for in-stock items in " +
      "original condition. Custom designs and modified slabs are non-returnable.",
    rows: [
      {
        label: `Orders over £${FREE_DELIVERY_THRESHOLD}`,
        value: "Free UK delivery",
      },
      {
        label: "Tiles & flooring orders",
        value: `£${TILE_FLOORING_DELIVERY} flat rate per order`,
      },
      {
        label: "All other orders",
        value: `£${STANDARD_ITEM_DELIVERY} flat rate per order`,
      },
      { label: "Delivery time", value: STANDARD_DELIVERY.blurb },
      {
        label: "Returns window",
        value: "14 days from receipt, in-stock items in original condition",
      },
    ],
  };
  supplierSections.push(deliverySection);
  const infoDropdowns = Array.isArray((product as any).infoDropdowns)
    ? (product as any).infoDropdowns
    : [];
  // "Add-ons for this product", shown under the gallery as on their PDP.
  const addOns = await resolveAddonProducts(
    (product as any).addonHandles,
    String(product._id),
  );

  /**
   * The closing banner follows the product's own department.
   *
   * A tile page should not sign off on a bathroom. `departmentMenuImage` is
   * the same resolver the mega menu uses for its department panels, so the
   * banner and the menu show a department the same way — and a department
   * that gets a photograph uploaded in the admin changes both at once.
   */
  const productDepartment = (deptRes.departments || []).find(
    (d: any) => String(d?.slug || "") === String(product.department || ""),
  );
  const closingBannerImage =
    departmentMenuImage(productDepartment) || CLOSING_BANNER_FALLBACK;

  // Resolved once: the delivered gallery, already Shopify URLs in `position`
  // order, with unmirrored entries (videos) left where they were stored.
  const images = getProductGalleryImages(resolveGalleryImages(product));

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
    // Porcious tiles: installation/cleaning guide lives in specs.careInstructions
    // (no top-level installationGuide field was set on these 29 products).
    (typeof specs.careInstructions === "string" && specs.careInstructions.trim()
      ? specs.careInstructions
      : null) ||
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
      {/*
        The header sits on the photograph, as it does on the reference's
        product pages: transparent over the image at the top of the page and
        going solid once you scroll past it. Measured there — the media
        starts at y=31, directly under the announcement bar, and the 98px
        header floats on top of it rather than above it.
      */}
      <Navbar
        initialDepartments={deptRes.departments || []}
        initialStoreName={storeName}
        overlay
      />

      {/*
        Not `page-top`: that clears the announcement bar and the header, which
        is right while the gallery is stacked on a phone, but on md and up the
        photograph is meant to run underneath the header. So the page clears
        only the announcement bar there, and the buy card carries its own
        header-height offset.
      */}
      <div className="pt-[calc(var(--lx-announce-h)+var(--lx-header-h))] pb-16 md:pb-20 md:pt-(--lx-announce-h)">
        <ProductSection
          support={support}
                product={{
                  id: product._id,
                  name: product.name,
                  price: product.price,
            images,
            // Lets the gallery switch an image to its Shopify copy when
            // Cloudinary does not answer for it.
            shopifyImages: product.shopifyImages,
                  category: product.category,
            categoryName: category?.name || product.category,
            categoryHref,
            subCategory: product.subCategory || undefined,
            subCategoryName:
              subCategoryMenu?.name || product.subCategory || undefined,
            brandName: matchedBrand?.name,
            brandSlug,
            priceMode: pickSpec(specs, "priceDisplay") || undefined,
            stock: product.stock ?? 0,
            shopifyVariantId: product.shopifyVariantId,
            sku: pickSpec(specs, "sku"),
            productCode: pickSpec(specs, "productCode"),
            size: productSize,
            sizeOptions,
            sqmPerBox:
              pickSpec(specs, "sqmPerBox") ||
              pickSpec(specs, "Pack Coverage") ||
              pickSpec(specs, "packCoverage"),
            // Marks the product a pergola, which is sold by the unit and must
            // not pick up outdoor-living's per-m² calculator.
            pergolaSizeRows: pergolaRows,
            // The same rule stated directly, for unit-sold goods that carry no
            // Oscar-shaped size grid (AlunoTec's pergolas, blinds and doors).
            soldPerUnit: Boolean((product as any).soldPerUnit),
            // Vimeo posters are not derivable from the video id, so the
            // supplier's preview still travels with the gallery src.
            videoPosters: Object.fromEntries(
              ((product as any).externalVideos || [])
                .filter((v: any) => v?.src && v?.posterUrl)
                .map((v: any) => [String(v.src), String(v.posterUrl)]),
            ),
            pricePerM2: (() => {
              const raw = pickSpec(specs, "pricePerM2");
              if (raw == null || raw === "") return null;
              const n = Number(raw);
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            // Porcious tiles only: £/m² by delivery zone (1-4) x order-size
            // bracket, and the minimum order size. Nested object, so read
            // straight off specs rather than through pickSpec (scalars only).
            zonePricing:
              specs.zonePricing && typeof specs.zonePricing === "object"
                ? (specs.zonePricing as Record<string, Record<string, number>>)
                : null,
            minimumOrderM2: (() => {
              const n = Number(specs.minimumOrderM2);
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            minimumOrderBoxes: (() => {
              const n = Number(specs.minimumOrderBoxes);
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            packCoverageM2: (() => {
              const raw =
                pickSpec(specs, "packCoverageM2") ||
                pickSpec(specs, "sqmPerBox") ||
                pickSpec(specs, "Pack Coverage") ||
                pickSpec(specs, "packCoverage") ||
                pickSpec(specs, "Pack Size");
              if (raw == null || raw === "") return null;
              const n = Number(String(raw).replace(/[^0-9.]/g, ""));
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            pricePerPack: (() => {
              const raw =
                pickSpec(specs, "pricePerPack") ||
                pickSpec(specs, "Price Per Pack") ||
                // Flooring Sales quotes the pack price as the product price.
                (pickSpec(specs, "fslSlug") ? String(product.price) : "");
              if (raw == null || raw === "") return null;
              const n = Number(String(raw).replace(/[^0-9.]/g, ""));
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            // Direct Flooring quotes per m² with pack coverage listed
            // separately; Spectra quotes a box price. `unit` tells them apart,
            // so the per-m² rate is not divided by pack size twice.
            priceIsPerSqm: /per\s*m2|per\s*m²/i.test(
              String(pickSpec(specs, "unit") ?? pickSpec(specs, "priceUnit") ?? ""),
            ),
            tilesPerBox: (() => {
              const raw =
                pickSpec(specs, "tilesPerBox") ||
                pickSpec(specs, "pcsIn1Box") ||
                pickSpec(specs, "Tiles / Box") ||
                pickSpec(specs, "Tiles per Box");
              if (raw == null || raw === "") return null;
              const n = Number(String(raw).replace(/[^0-9.]/g, ""));
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            tilesPerSqm: (() => {
              const raw =
                pickSpec(specs, "tilesPerSqm") ||
                pickSpec(specs, "pcsIn1Sqm") ||
                pickSpec(specs, "Tiles per m2") ||
                pickSpec(specs, "Tiles per m²");
              if (raw == null || raw === "") return null;
              const n = Number(String(raw).replace(/[^0-9.]/g, ""));
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            /*
             * Tile Mountain's buy card counts whatever actually ships — a
             * pack for click flooring, a tile or a mosaic sheet otherwise —
             * and their calculator needs to know which, what one costs, and
             * whether part of one can be ordered.
             */
            orderUnit: pickSpec(specs, "orderUnit") || undefined,
            minFullPack: /^(true|1|yes)$/i.test(pickSpec(specs, "minFullPack") ?? ""),
            unitPrice: (() => {
              const n = Number(pickSpec(specs, "unitPrice"));
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            /** A mosaic is priced per sheet, so its m² rate is kept apart. */
            sheetPricePerM2: (() => {
              const n = Number(pickSpec(specs, "sheetPricePerM2"));
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            samplePrice: (() => {
              const raw =
                pickSpec(specs, "samplePrice") ||
                pickSpec(specs, "Sample Price");
              if (raw == null || raw === "") return null;
              const n = Number(String(raw).replace(/[^0-9.]/g, ""));
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            hasPaidSample: hasPaidSampleFlow(specs),
            leadTimeLabel: (() => {
              const raw =
                (product as any).stockAvailabilityText ||
                pickSpec(specs, "leadTimeLabel") ||
                pickSpec(specs, "Lead Time") ||
                pickSpec(specs, "stockStatusLabel") ||
                pickSpec(specs, "stockAvailability");
              return raw != null && String(raw).trim()
                ? String(raw).trim()
                : null;
            })(),
            leadTimeDetail: (() => {
              const raw =
                pickSpec(specs, "leadTimeDetail") ||
                pickSpec(specs, "Estimated Ship") ||
                pickSpec(specs, "shippingEstimate");
              return raw != null && String(raw).trim()
                ? String(raw).trim()
                : null;
            })(),
            department: product.department || undefined,
            salePercent,
            compareAtPrice: (() => {
              // Raise-then-%: price is already the raised actual; salePercent
              // applies the off. compareAt === price would hide the sale.
              if (String(pickSpec(specs, "salePriceMode") || "") === "raise-then-percent") {
                return null;
              }
              const raw =
                pickSpec(specs, "shopifyCompareAt") ||
                pickSpec(specs, "compareAtPrice");
              if (raw == null || raw === "") return null;
              const n = Number(raw);
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            averageRating:
              reviewData.count > 0
                ? reviewData.average
                : Number(supplierRating?.rating) || 0,
            reviewCount:
              reviewData.count > 0
                ? reviewData.count
                : Number(supplierRating?.count) || 0,
            insulatingSetPrice: extras.insulatingSetPrice,
            finishes: extras.finishes,
            flashings: extras.flashings,
            moreFromProducts,
            featureEntries,
            packingEntries,
            legalDisclaimer: legalDisclaimer || null,
            colorOptions,
            productSizes,
            bases,
            shades,
            pendants,
            wallFittings,
            efficiency,
            productType:
              pickSpec(specs, "productType") ||
              pickSpec(specs, "pookyType") ||
              null,
            coverage,
            nestedOptions,
            doTheJobRight,
            optionInfo,
            optionElements,
            shopifyOptions,
            ufhsVariants,
            // Supplier banners link back to their own site — show art only.
            stockAvailabilityText: String(
              (product as any).stockAvailabilityText || "",
            ),
            addonGroups: Array.isArray((product as any).addonGroups)
              ? (product as any).addonGroups
              : [],
            darkModeImage: (product as any).hasDarkModeToggle
              ? (product as any).darkModeImage || ""
              : "",
            promoBanner: (product as any).promoBanner?.image
              ? {
                  image: (product as any).promoBanner.image,
                  alt: (product as any).promoBanner.alt || "",
                }
              : null,
            hasMeasureMyRoom:
              (product as any).specs?.hasMeasureMyRoom === true
                ? true
                : (product as any).specs?.hasMeasureMyRoom === false
                  ? false
                  : null,
            // Separate fields → separate dropdowns (both can show).
            downloads: downloadsForPdp,
            filesDocumentation,
            swatchGroups,
            supplierSections,
            infoDropdowns,
            addOns,
            addOnsHeading: String((product as any).addonsHeading || ""),
            catalogVariants: Array.isArray((product as any).variants)
              ? (product as any).variants
              : [],
          }}
          belowMedia={
            <>
          {/*
            The rights line, directly under the photograph — the first thing
            in the left column, as on the reference.

            Measured there at 1440: 10px on a 14px line, 1px tracking, 50%
            black, left-aligned at x=128 with 12px above it. The column's own
            inset supplies the 128.

            The wording is not theirs. Lusso designs what it sells, so it
            claims the designs outright; this catalogue resells other
            manufacturers' ranges, and asserting ownership of their designs
            and photography would be false. The claim here is over the site
            itself, with the makers' rights left where they belong.
          */}
          <p className="px-4 pt-3 text-[10px] leading-3.5 tracking-[1px] text-black/50 md:px-0">
            © {storeName}. All rights reserved. Product designs, imagery and
            specifications remain the property of their respective
            manufacturers and may not be copied or reproduced without
            permission.
          </p>

          {/* The reference's first strip sits between the buy card and the
              accordions, the width of the page rather than of the info column
              — this used to be a 720px "More suggestions" block nested inside
              ProductSection. */}
          <ProductCarousel
            title="Frequently bought together"
            inColumn
            products={moreSuggestionProducts}
          />

          {/*
            Every dropdown on the page, in one run after the first strip —
            where the reference keeps its accordion. These five used to render
            inside ProductSection's column, which opened them *above* the
            strip with the accordion below it, so the page had two separate
            sets of dropdowns with a carousel wedged between them.

            Same 592px column at x=128 the accordion uses, so the rules line
            up from the first row to the last.
          */}
          <div className="px-4 pt-12 md:pt-16 min-[990px]:px-0">
            <div>
              <ProductSupplierSections
                sections={supplierSections}
                infoDropdowns={infoDropdowns}
              />

              <ProductFeaturePacking
                features={featureEntries}
                packing={packingEntries}
                legalDisclaimer={(product as any).legalDisclaimer}
              />

              <ProductFilesDocumentation sections={filesDocumentation} />

              <ProductDownloads downloads={downloadsForPdp} />

              <ProductAddOns
                heading={
                  String((product as any).addonsHeading || "") ||
                  "Add-ons for this product"
                }
                items={addOns}
              />
            </div>
          </div>

          <div>
            <ProductDetailTabs
              productId={product._id}
              description={product.description || ""}
              shortDescription={(product as any).shortDescription || ""}
              specs={combinedSpecs}
              specTable={
                pergolaTable ||
                (product as any).specs?.sizeWeightTable ||
                // Porcious tiles: technicalSpecification is a structured
                // {standard, characteristics[]} object, not the sizeWeightTable
                // shape the tab expects — convert it to the same table shape.
                (() => {
                  const tech = specs.technicalSpecification as
                    | {
                        standard?: string;
                        characteristics?: {
                          name: string;
                          standard: string;
                          porcious: string;
                          test: string;
                        }[];
                      }
                    | undefined;
                  if (!tech?.characteristics?.length) return null;
                  return {
                    caption: tech.standard,
                    headings: ["Characteristic", "Standard Requires", "Porcious Mean Value", "Test Method"],
                    rows: tech.characteristics.map((c) => [
                      c.name,
                      c.standard,
                      c.porcious,
                      c.test,
                    ]),
                  };
                })()
              }
              showSpecs={product.showSpecs !== false}
              schematicImage={product.schematicImage || undefined}
              reviews={reviewData.reviews}
              averageRating={
                reviewData.count > 0
                  ? reviewData.average
                  : Number(supplierRating?.rating) || 0
              }
              reviewCount={
                reviewData.count > 0
                  ? reviewData.count
                  : Number(supplierRating?.count) || 0
              }
              installationGuide={installationGuideForTabs}
              flashingFinder={extras.flashingFinder}
              brochures={Array.isArray((product as any).brochures) ? (product as any).brochures : []}
              productRange={Array.isArray((product as any).productRange) ? (product as any).productRange : []}
              caseStudies={Array.isArray((product as any).caseStudies) ? (product as any).caseStudies : []}
              generalSpecification={(product as any).generalSpecification || null}
              installerGuides={Array.isArray((product as any).installerGuides) ? (product as any).installerGuides : []}
              warrantyFiles={Array.isArray((product as any).warrantyFiles) ? (product as any).warrantyFiles : []}
              drawingEntries={Array.isArray((product as any).drawingEntries) ? (product as any).drawingEntries : []}
              suitability={(product as any).suitability || null}
              delivery={(product as any).delivery || ""}
              howItsMade={(product as any).howItsMade || ""}
              productAndSampleOrders={(product as any).productAndSampleOrders || ""}
              installationMaintenanceGuides={
                Array.isArray((product as any).installationMaintenanceGuides)
                  ? (product as any).installationMaintenanceGuides
                  : []
              }
              finishGuide={Array.isArray((product as any).finishGuide) ? (product as any).finishGuide : []}
              materialAndCare={(product as any).materialAndCare || null}
              responsibilityAndCompliance={
                (product as any).responsibilityAndCompliance || null
              }
              maintenance={(product as any).maintenance || null}
              typeOptions={Array.isArray((product as any).typeOptions) ? (product as any).typeOptions : []}
              manuals={
                Array.isArray((product as any).manuals)
                  ? (product as any).manuals
                  : []
              }
              usage={Array.isArray((product as any).usage) ? (product as any).usage : []}
            />
            <ProductUsageExplore
              usage={Array.isArray((product as any).usage) ? (product as any).usage : []}
            />
          </div>

            {/*
              The rest of the strips, in the column too.

              They were page-level sections below it, which ended the card's
              sticky run at the accordion. On the reference the card is
              pinned for the whole of the left column, and these are part of
              it — so the card now holds past Complete the look and lets go
              at the end of Recently viewed, where the full-width bands
              start.

              `inColumn` because the column already supplies the 128px inset
              and the half width; at page level they measured the same 592px
              track, so nothing about them moves.
            */}
            <ProductCarousel
              title="You may also like"
              inColumn
              products={alsoLikeProducts}
            />
            <ProductCarousel
              title="Complete the look"
              inColumn
              products={completeTheLookProducts}
            />
            <RecentlyViewed current={toCarouselProduct(product)} inColumn />
            </>
          }
        />

      </div>

      {/*
        "Secure your order" — the outlined panel the reference puts between
        the last carousel and its reviews. Measured at 1440:

          box      1260 wide (90px margins), 1px #cdcdcd, 2px radius,
                   56px top / 32px side / 52px bottom padding
          heading  24px, centred, sitting across the top border on a white
                   ground, 24px of side padding punching the rule
          column   382px, centred, 64px icon above a 14px title
          gutter   24px between columns

        Theirs reads "30% DEPOSIT / Hold Your Items 60 days / Pay Later with
        PayPal". Those are Lusso's commercial terms, not ours, so the shape
        is copied and the content is not — every line below is something
        this store genuinely offers.
      */}
      <section className="px-4 py-16 min-[990px]:px-8">
        <div className="relative mx-auto max-w-315 rounded-[2px] border border-[#cdcdcd] px-8 pt-14 pb-13">
          {/* 24px at the reference's width; stepped down on a phone, where a
              371px nowrap heading pushed 6px of the page off the right. */}
          <h2 className="font-menu absolute -top-3.5 left-1/2 max-w-[calc(100%-1rem)] -translate-x-1/2 bg-white px-6 text-center text-[16px] font-medium uppercase leading-[1.2] tracking-[1.92px] whitespace-nowrap text-black min-[750px]:text-[24px]">
            Secure your order
          </h2>

          <ul
            role="list"
            className="mx-auto grid max-w-298.5 grid-cols-1 gap-x-6 gap-y-10 text-center sm:grid-cols-3"
          >
            {[
              {
                title: "Free samples",
                body: "See the finish in your own light before you commit.",
                Icon: PackageOpen,
              },
              {
                title: "Trade accounts",
                body: "Project pricing, dedicated support and priority lead times.",
                Icon: BadgePercent,
              },
              {
                // The reference's third column is "Pay Later with PayPal".
                // Ours names both providers the buy card already offers
                // rather than repeating their terms.
                title: "Pay later",
                body: "Spread the cost with Klarna or PayPal, subject to status.",
                Icon: CreditCard,
              },
            ].map(({ title, body, Icon }) => (
              <li key={title} className="flex flex-col items-center">
                <Icon className="h-16 w-16 stroke-[0.75] text-black" />
                <p className="font-menu mt-6 text-[14px] font-medium uppercase leading-[16.8px] tracking-[1.4px] text-black">
                  {title}
                </p>
                <p className="mt-3 text-[14px] leading-[1.4] text-black/60">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/*
        Reviews as their own section rather than a row in the accordion —
        the reference gives them a band of their own between the terms row
        and the contact panel, in a 1248px column under a 14px heading.

        That column starts at x=160 and ends 32px off the right edge — wider
        than the 1184 the accordion and carousels use, and not centred, which
        is how the reference lays it out.
      */}
      <section
        id="product-reviews"
        className="scroll-mt-28 border-t border-foreground/10 px-4 py-16 min-[990px]:pr-8 min-[990px]:pl-40"
      >
        <div className="mx-auto max-w-312">
          <h2 className="font-menu mb-8 text-[14px] font-medium uppercase leading-[16.8px] tracking-[1.4px] text-black">
            Customer reviews
          </h2>
          <ProductReviewsPanel
            productId={String(product._id)}
            reviews={reviewData.reviews}
            averageRating={
              reviewData.count > 0
                ? reviewData.average
                : Number(supplierRating?.rating) || 0
            }
            reviewCount={
              reviewData.count > 0
                ? reviewData.count
                : Number(supplierRating?.count) || 0
            }
          />
        </div>
      </section>

      {/*
        The contact panel, measured off the reference at 1440: a grey band
        the width of the window holding two white cards.

          band     full width, #efefef, 60px top and bottom
          heading  24px, left-aligned over the cards, not centred
          card     438px, white, 4px radius, 40px/30px padding
          gutter   24px between the two — 438 + 24 + 438 = 900
          icon     32px above an 18px title
          button   full card width (378), 40px tall, 12px
      */}
      <section className="bg-[#efefef] px-5 py-15">
        <div className="mx-auto max-w-225">
          <h2 className="font-menu mb-6 text-[24px] font-medium uppercase leading-[1.2] tracking-[1.92px] text-black">
            Contact us
          </h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-lg bg-white px-7.5 py-10">
              <CalendarDays className="h-8 w-8 stroke-1 text-black" />
              <h3 className="font-menu mt-6 text-[18px] font-medium uppercase leading-[1.2] text-black">
                Book a consultation
              </h3>
              <p className="mt-4 text-[14px] leading-normal tracking-[0.35px] text-black">
                Talk a project through with our team — sizes, quantities and
                what else you will need before you order.
              </p>
              <a
                href="/contact"
                className="font-menu mt-8 flex h-10 w-full items-center justify-center bg-black px-6 text-[12px] font-medium uppercase leading-[1.4] tracking-[0.6px] text-white transition-opacity hover:opacity-90"
              >
                Book a consultation
              </a>
            </div>

            <div className="rounded-lg bg-white px-7.5 py-10">
              <PhoneCall className="h-8 w-8 stroke-1 text-black" />
              <h3 className="font-menu mt-6 text-[18px] font-medium uppercase leading-[1.2] text-black">
                Get in touch
              </h3>
              <p className="mt-4 text-[14px] leading-normal tracking-[0.35px] text-black">
                Call us on{" "}
                <a
                  href={support.phoneHref}
                  className="text-black underline underline-offset-4"
                >
                  {support.phone}
                </a>{" "}
                or email{" "}
                <a
                  href={`mailto:${support.email}`}
                  className="text-black underline underline-offset-4"
                >
                  {support.email}
                </a>
                .
              </p>
              <a
                href={support.phoneHref}
                className="font-menu mt-8 flex h-10 w-full items-center justify-center bg-black px-6 text-[12px] font-medium uppercase leading-[1.4] tracking-[0.6px] text-white transition-opacity hover:opacity-90"
              >
                Call now
              </a>
            </div>
          </div>
        </div>
      </section>

      {/*
        The full-bleed photograph the reference closes on — 1440 x 720 at
        desktop, so a 2:1 band the width of the window, with nothing over it.
      */}
      <section className="relative aspect-square w-full overflow-hidden bg-secondary/40 min-[750px]:aspect-2/1">
        <Image
          src={closingBannerImage}
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
        />
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}

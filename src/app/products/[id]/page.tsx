import React from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProductDetailTabs } from "@/components/products/ProductDetailTabs";
import { ProductUsageExplore } from "@/components/products/ProductUsageExplore";
import { ProductSection } from "@/components/products/ProductSection";
import { getSupportContact } from "@/lib/support";
import { getPublicProduct, getPublicProducts } from "@/app/actions/products";
import { getApprovedProductReviews } from "@/app/actions/reviews";
import { getMenuBySlug, getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/products/ProductCard";
import { PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import { getProductDisplayImage, getProductGalleryImages } from "@/lib/productImage";
import { hasPaidSampleFlow } from "@/lib/priceOnRequest";
import { parseProductExtras } from "@/lib/productExtras";
import { pickMoreFromProducts, pickSizeOptions } from "@/lib/moreFromProducts";
import { formatDisplaySize } from "@/lib/sizeBuckets";
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

  // Overlap nav + reviews with the product read. Related/trending use one
  // lean query each (was 3 heavy listing queries blocking first paint).
  const storeNamePromise = getStoreName();
  const brandPromise = getBrandMenuTrees();
  const deptPromise = getDepartmentTrees();
  const reviewPromise = getApprovedProductReviews(id);
  const supportPromise = getSupportContact();
  const trendingPromise = getPublicProducts({
    limit: 8,
    sort: "newest",
    fields: "name price images category stock brand",
    skipCount: true,
  });

  const support = await supportPromise;
  const product = await getPublicProduct(id);

  if (!product) {
    notFound();
  }

  const [
    category,
    subCategoryMenu,
    { products: trendingProducts },
    relatedByCategory,
    storeName,
    brandRes,
    deptRes,
    reviewData,
  ] = await Promise.all([
    getMenuBySlug(product.category),
    product.subCategory
      ? getMenuBySlug(product.subCategory)
      : Promise.resolve(null),
    trendingPromise,
    getPublicProducts({
      category: product.category,
      limit: 40,
      sort: "newest",
      fields:
        "name price images category stock shopifyVariantId specs.baseTitle specs.spectraTitle specs.size specs.Size brand",
      skipCount: true,
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

  const supplierRating = (product as any).reviewSummary || null;

  const images = getProductGalleryImages(product.images);

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
        initialDepartments={deptRes.departments || []}
        initialStoreName={storeName}
      />

      <div className="page-top pb-16 md:pb-20 px-4 md:px-6 lg:px-20 max-w-7xl mx-auto">
        <ProductSection
          support={support}
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
            pricePerM2: (() => {
              const raw = pickSpec(specs, "pricePerM2");
              if (raw == null || raw === "") return null;
              const n = Number(raw);
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
            samplePrice: (() => {
              const raw =
                pickSpec(specs, "samplePrice") ||
                pickSpec(specs, "Sample Price");
              if (raw == null || raw === "") return null;
              const n = Number(String(raw).replace(/[^0-9.]/g, ""));
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
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
          }}
        />

        <div className="mt-14 md:mt-20">
          <ProductDetailTabs
            productId={product._id}
            description={product.description || ""}
            shortDescription={(product as any).shortDescription || ""}
            specs={combinedSpecs}
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
      </div>

      <section className="py-12 sm:py-16 md:py-24 px-4 sm:px-6 lg:px-20 border-t border-foreground/5 bg-secondary/5">
        <div className="flex flex-col items-center text-center mb-10 sm:mb-16 space-y-4">
          <p className="uppercase tracking-[0.4em] text-[10px] font-bold">
            Selection
          </p>
          <h2 className="text-2xl sm:text-3xl font-serif tracking-[0.2em] uppercase">
            What&apos;s Trending
          </h2>
          <div className="w-12 h-px bg-foreground/10 mt-4" />
        </div>

        {trendingProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-6">
            {trendingProducts.map((trendingProduct: any) => {
              const tBrandId = trendingProduct.brand
                ? String(
                    typeof trendingProduct.brand === "object"
                      ? trendingProduct.brand._id || trendingProduct.brand
                      : trendingProduct.brand,
                  )
                : "";
              const tBrand = tBrandId
                ? brands.find((b: any) => String(b._id) === tBrandId)
                : null;
              return (
              <ProductCard
                key={trendingProduct._id}
                id={trendingProduct._id}
                name={trendingProduct.name}
                price={trendingProduct.price}
                image={getProductDisplayImage(trendingProduct.images)}
                images={trendingProduct.images}
                category={trendingProduct.category}
                categoryName={trendingProduct.category}
                department={trendingProduct.department}
                brandName={tBrand?.name}
                brandSlug={tBrand?.slug}
                priceMode={trendingProduct.specs?.priceDisplay || undefined}
                pricePerM2={
                  Number(trendingProduct.specs?.pricePerM2) > 0
                    ? Number(trendingProduct.specs.pricePerM2)
                    : null
                }
                size={trendingProduct.specs?.size || undefined}
                hasPaidSample={hasPaidSampleFlow(trendingProduct.specs)}
                salePercent={
                  typeof trendingProduct.specs?.salePercent === "number"
                    ? trendingProduct.specs.salePercent
                    : null
                }
                vatRate={
                  trendingProduct.vatRate == null
                    ? 20
                    : Number(trendingProduct.vatRate)
                }
                stock={trendingProduct.stock}
                shopifyVariantId={trendingProduct.shopifyVariantId}
              />
              );
            })}
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

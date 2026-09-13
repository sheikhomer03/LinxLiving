"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Box,
  Check,
  ChevronDown,
  FileText,
  Mail,
  Phone,
  ShieldCheck,
  Star,
  Wrench,
  Layers,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductReviewsPanel } from "@/components/products/ProductReviews";
import { OPEN_PRODUCT_REVIEWS_EVENT } from "@/components/products/ProductRatingSummary";
import type { FlashingFinderItem } from "@/lib/productExtras";
import type {
  CaseStudyItem,
  DrawingEntry,
  GeneralSpecification,
  NamedFile,
  ProductRangeItem,
} from "@/lib/productBritmetDocs";
import {
  hasSuitability,
  type ProductSuitability,
} from "@/lib/productSuitability";
import {
  hasUsageItems,
  type InstallationMaintenanceGuide,
  type ProductUsageItem,
} from "@/lib/productOttoSections";

type SpecItem = { label: string; value: string };

/** Optional full data table shown under the label/value spec grid — e.g. a
 * supplier's size/weight lookup table that doesn't fit the label/value shape. */
type SpecTable = {
  caption?: string;
  headings: string[];
  rows: string[][];
};

type ReviewItem = {
  _id: string;
  name: string;
  rating: number;
  title?: string;
  comment: string;
  createdAt: string;
};

interface ProductDetailTabsProps {
  productId: string;
  description: string;
  shortDescription?: string;
  specs: SpecItem[];
  /** Optional full table (e.g. size/weight lookup) shown below the spec grid. */
  specTable?: SpecTable | null;
  showSpecs: boolean;
  schematicImage?: string;
  reviews: ReviewItem[];
  averageRating: number;
  reviewCount: number;
  installationGuide?: string | null;
  flashingFinder?: FlashingFinderItem[];
  brochures?: NamedFile[];
  productRange?: ProductRangeItem[];
  caseStudies?: CaseStudyItem[];
  generalSpecification?: GeneralSpecification | null;
  installerGuides?: NamedFile[];
  warrantyFiles?: NamedFile[];
  drawingEntries?: DrawingEntry[];
  suitability?: ProductSuitability | null;
  delivery?: string | null;
  howItsMade?: string | null;
  productAndSampleOrders?: string | null;
  installationMaintenanceGuides?: InstallationMaintenanceGuide[];
  /** Plankhardware-style flexible sections (optional). */
  finishGuide?: {
    name: string;
    imageUrl?: string;
    description?: string;
    pairsWellWith?: { description?: string; images?: string[] };
  }[];
  materialAndCare?: { html?: string; images?: string[] } | null;
  responsibilityAndCompliance?: { html?: string; images?: string[] } | null;
  maintenance?: { html?: string; images?: string[] } | null;
  typeOptions?: {
    name: string;
    description?: string;
    imageUrl?: string;
    price?: number;
    stock?: number;
  }[];
  /** Supplier "Manuals" section — product manuals / installation guides. */
  manuals?: NamedFile[];
  usage?: ProductUsageItem[];
}

type TabKey =
  | "description"
  | "specs"
  | "brochure"
  | "range"
  | "cases"
  | "general"
  | "suitability"
  | "installer"
  | "warranty"
  | "drawings"
  | "install"
  | "flashing"
  | "finishGuide"
  | "materialCare"
  | "responsibilityCompliance"
  | "maintenance"
  | "typeOptions"
  | "reviews";

export function ProductDetailTabs({
  productId,
  description,
  shortDescription = "",
  specs,
  specTable = null,
  showSpecs,
  schematicImage,
  reviews,
  averageRating,
  reviewCount,
  installationGuide,
  flashingFinder = [],
  brochures = [],
  productRange = [],
  caseStudies = [],
  generalSpecification = null,
  installerGuides = [],
  warrantyFiles = [],
  drawingEntries = [],
  suitability = null,
  delivery = null,
  howItsMade = null,
  productAndSampleOrders = null,
  installationMaintenanceGuides = [],
  finishGuide = [],
  materialAndCare = null,
  responsibilityAndCompliance = null,
  maintenance = null,
  typeOptions = [],
  manuals = [],
  usage = [],
}: ProductDetailTabsProps) {
  const hasInstall = Boolean(String(installationGuide || "").trim());
  const hasFinder = flashingFinder.length > 0;
  const hasBrochure = brochures.length > 0;
  const hasRange = productRange.length > 0;
  const hasCases = caseStudies.length > 0;
  const hasGeneral = Boolean(
    String(generalSpecification?.content || "").trim() ||
      String(generalSpecification?.image || "").trim(),
  );
  const hasSuitabilityTab = hasSuitability(suitability);
  const hasInstallerGuides = installerGuides.length > 0;
  const hasWarranty = warrantyFiles.length > 0;
  const hasDrawings = drawingEntries.length > 0;
  const deliveryText = String(delivery || "").trim();
  const howItsMadeText = String(howItsMade || "").trim();
  const sampleOrdersText = String(productAndSampleOrders || "").trim();
  const manualFiles = manuals.filter((m) => m?.name && m?.url);
  const manualUrls = new Set(manualFiles.map((m) => m.url));
  // Manuals get their own block, so keep them out of the guides list.
  const guides = installationMaintenanceGuides.filter(
    (g) => g.name && g.url && !manualUrls.has(g.url),
  );
  const usageItems = usage.filter((u) => u.image || u.title);
  const hasDescExtras =
    Boolean(deliveryText) ||
    Boolean(howItsMadeText) ||
    Boolean(sampleOrdersText) ||
    guides.length > 0 ||
    manualFiles.length > 0 ||
    hasUsageItems(usageItems);

  const hasFinishGuide = (finishGuide || []).length > 0;
  const hasMaterialCare =
    Boolean(materialAndCare?.html && String(materialAndCare.html).trim()) ||
    (materialAndCare?.images || []).length > 0;
  const hasResponsibility =
    Boolean(
      responsibilityAndCompliance?.html &&
        String(responsibilityAndCompliance.html).trim(),
    ) || (responsibilityAndCompliance?.images || []).length > 0;
  const hasMaintenance =
    Boolean(maintenance?.html && String(maintenance.html).trim()) ||
    (maintenance?.images || []).length > 0;
  const hasTypeOptions = (typeOptions || []).length > 0;

  function formatMoney(n: number) {
    if (!Number.isFinite(Number(n))) return "";
    return `£${Number(n).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function renderHtmlOrText(html: string | undefined | null) {
    const v = String(html || "").trim();
    if (!v) return null;
    if (/<[a-z][\s\S]*>/i.test(v)) {
      return (
        <div
          className="prose prose-sm prose-neutral max-w-3xl [&_img]:rounded-md"
          dangerouslySetInnerHTML={{ __html: v }}
        />
      );
    }
    return (
      <p className="text-sm md:text-[15px] leading-[1.8] text-foreground/75 whitespace-pre-line font-sans">
        {v}
      </p>
    );
  }

  const tabs: {
    key: TabKey;
    label: string;
    icon: typeof FileText;
    hidden?: boolean;
  }[] = [
    { key: "description", label: "Product Description", icon: FileText },
    {
      key: "specs",
      label: "Technical Specifications",
      icon: Box,
      hidden: !showSpecs,
    },
    { key: "brochure", label: "Brochure", icon: FileText, hidden: !hasBrochure },
    { key: "range", label: "Product Range", icon: Layers, hidden: !hasRange },
    { key: "cases", label: "Case Studies", icon: Star, hidden: !hasCases },
    {
      key: "general",
      label: "General Specification",
      icon: FileText,
      hidden: !hasGeneral,
    },
    {
      key: "suitability",
      label: "Suitability",
      icon: Layers,
      hidden: !hasSuitabilityTab,
    },
    {
      key: "installer",
      label: "Installer Guide",
      icon: Wrench,
      hidden: !hasInstallerGuides,
    },
    {
      key: "warranty",
      label: "Warranty",
      icon: ShieldCheck,
      hidden: !hasWarranty,
    },
    {
      key: "drawings",
      label: "Technical Drawings",
      icon: Box,
      hidden: !hasDrawings,
    },
    {
      key: "install",
      label: "Installation",
      icon: Wrench,
      hidden: !hasInstall,
    },
    {
      key: "flashing",
      label: "Flashing Finder",
      icon: Layers,
      hidden: !hasFinder,
    },
    {
      key: "finishGuide",
      label: "Finish Guide",
      icon: FileText,
      hidden: !hasFinishGuide,
    },
    {
      key: "materialCare",
      label: "Material & Care",
      icon: FileText,
      hidden: !hasMaterialCare,
    },
    {
      key: "responsibilityCompliance",
      label: "Responsibility & Compliance",
      icon: FileText,
      hidden: !hasResponsibility,
    },
    {
      key: "maintenance",
      label: "Maintenance",
      icon: FileText,
      hidden: !hasMaintenance,
    },
    {
      key: "typeOptions",
      label: "Type",
      icon: FileText,
      hidden: !hasTypeOptions,
    },
    { key: "reviews", label: "Reviews", icon: Star },
  ];

  const visibleTabs = tabs.filter((t) => !t.hidden);
  const [active, setActive] = useState<TabKey | "">(
    visibleTabs[0]?.key || "description",
  );
  const [rangeModal, setRangeModal] = useState<ProductRangeItem | null>(null);

  useEffect(() => {
    const openReviews = () => {
      setActive("reviews");
      requestAnimationFrame(() => {
        document
          .getElementById("product-detail-tabs")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    window.addEventListener(OPEN_PRODUCT_REVIEWS_EVENT, openReviews);
    return () =>
      window.removeEventListener(OPEN_PRODUCT_REVIEWS_EVENT, openReviews);
  }, []);

  useEffect(() => {
    if (!rangeModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRangeModal(null);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [rangeModal]);

  /**
   * One entry per section, keyed by its tab.
   *
   * These are the same blocks the tab bar revealed one at a time, lifted out
   * verbatim so the accordion can put each under its own heading — which is
   * where the reference keeps them. Nothing is new and nothing is dropped: a
   * section that was conditional still carries its condition and renders
   * nothing when it is unmet.
   */
  const PANELS: Partial<Record<TabKey, React.ReactNode>> = {
    description: (
          <div className="space-y-12 animate-in fade-in duration-300">
            <div className="space-y-6">
                <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
                  Product Description
                </h2>
                {(() => {
                  const combined = [shortDescription, description]
                    .map((s) => String(s || "").trim())
                    .filter(Boolean)
                    .join("\n\n");
                  if (!combined) {
                    return (
                      <p className="text-sm md:text-[15px] leading-[1.8] text-foreground/75 font-sans">
                        No description available for this product.
                      </p>
                    );
                  }
                  // Live Shopify/Woo descriptions are often HTML — render as-is
                  if (/<[a-z][\s\S]*>/i.test(combined)) {
                    return (
                      <div
                        className="font-sans text-sm md:text-[15px] leading-[1.8] text-foreground/75 prose prose-sm prose-neutral max-w-none [&_img]:rounded-md [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline"
                        dangerouslySetInnerHTML={{ __html: combined }}
                      />
                    );
                  }
                  const paragraphs = combined
                    .split(/\n+/)
                    .map((p) => p.trim())
                    .filter(Boolean);
                  const [lead, ...rest] = paragraphs;
                  // Keep every line: short ones are real copy too (a bare
                  // dimension line, "10-year guarantee"), not stray fragments.
                  const bullets = rest;
                  return (
                    <div className="space-y-5 font-sans">
                      <p className="text-sm md:text-[15px] leading-[1.8] text-foreground/75 whitespace-pre-line">
                        {lead}
                      </p>
                      {bullets.length > 0 ? (
                        <ul className="space-y-3">
                          {bullets.map((item, index) => (
                            <li
                              key={`${index}-${item.slice(0, 32)}`}
                              className="flex gap-3 text-sm md:text-[15px] leading-[1.7] text-foreground/75"
                            >
                              <span
                                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/50"
                                aria-hidden
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })()}
            </div>

            <div className="space-y-4 border-t border-foreground/10 pt-10">
              <h3 className="text-[13px] uppercase tracking-[0.2em] font-bold text-foreground/80">
                Got a Question?
              </h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="mailto:info@linxsquare.co.uk"
                  className="flex-1 sm:max-w-xs border border-foreground/10 py-5 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 transition-all group"
                >
                  <Mail className="w-3.5 h-3.5 opacity-80" />
                  Contact Us
                </Link>
                <Link
                  href="tel:02046342203"
                  className="flex-1 sm:max-w-xs border border-foreground/10 py-5 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 transition-all group"
                >
                  <Phone className="w-3.5 h-3.5 opacity-80" />
                  Call us on 020 4634 2203
                </Link>
              </div>
            </div>

            {hasDescExtras ? (
              <div className="max-w-4xl space-y-4 border-t border-foreground/10 pt-10">
                {(
                  [
                    ["Delivery", deliveryText],
                    ["How It's Made", howItsMadeText],
                    ["Product and Sample Orders", sampleOrdersText],
                  ] as const
                )
                  .filter(([, text]) => text)
                  .map(([label, text]) => (
                    <details
                      key={label}
                      className="group border border-foreground/10 open:bg-secondary/20"
                    >
                      <summary className="cursor-pointer list-none flex items-center justify-between gap-4 px-5 py-4 text-[12px] uppercase tracking-[0.18em] font-bold">
                        {label}
                        <span className="text-foreground/40 group-open:rotate-45 transition-transform text-lg leading-none">
                          +
                        </span>
                      </summary>
                      <div className="px-5 pb-5 text-sm md:text-[15px] leading-[1.8] text-foreground/75 whitespace-pre-line font-sans">
                        {text}
                      </div>
                    </details>
                  ))}

                {/* Supplier accordions render under the buy box instead. */}

                {manualFiles.length > 0 ? (
                  <details className="group border border-foreground/10 open:bg-secondary/20">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-4 px-5 py-4 text-[12px] uppercase tracking-[0.18em] font-bold">
                      Manuals
                      <span className="text-foreground/40 group-open:rotate-45 transition-transform text-lg leading-none">
                        +
                      </span>
                    </summary>
                    <ul className="px-5 pb-5 space-y-3">
                      {manualFiles.map((m) => (
                        <li key={`${m.name}-${m.url}`}>
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4 hover:text-foreground/70"
                          >
                            <FileText className="w-4 h-4 opacity-70" />
                            {m.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {guides.length > 0 ? (
                  <details className="group border border-foreground/10 open:bg-secondary/20">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-4 px-5 py-4 text-[12px] uppercase tracking-[0.18em] font-bold">
                      Download Installation &amp; Maintenance Guides
                      <span className="text-foreground/40 group-open:rotate-45 transition-transform text-lg leading-none">
                        +
                      </span>
                    </summary>
                    <ul className="px-5 pb-5 space-y-3">
                      {guides.map((g) => (
                        <li key={`${g.name}-${g.url}`}>
                          <a
                            href={g.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4 hover:text-foreground/70"
                          >
                            <FileText className="w-4 h-4 opacity-70" />
                            {g.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {hasUsageItems(usageItems) ? (
                  <details className="group border border-foreground/10 open:bg-secondary/20">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-4 px-5 py-4 text-[12px] uppercase tracking-[0.18em] font-bold">
                      Usage
                      <span className="text-foreground/40 group-open:rotate-45 transition-transform text-lg leading-none">
                        +
                      </span>
                    </summary>
                    <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                      {usageItems.map((item, i) => (
                        <div
                          key={`${item.title}-${i}`}
                          className="flex flex-col items-center text-center gap-2 relative pt-1"
                        >
                          <div className="relative w-14 h-14">
                            {item.image ? (
                              <Image
                                src={item.image}
                                alt={item.title || "Usage"}
                                fill
                                className="object-contain"
                                sizes="56px"
                                unoptimized
                              />
                            ) : null}
                            {item.checked ? (
                              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                <Check className="w-3 h-3" strokeWidth={3} />
                              </span>
                            ) : null}
                          </div>
                          {item.title ? (
                            <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground/80">
                              {item.title}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        ),
    specs: showSpecs && (
          <div
            className={cn(
              "grid grid-cols-1 gap-12 lg:gap-16 items-start animate-in fade-in duration-300",
              schematicImage && "lg:grid-cols-2",
            )}
          >
            <div className="space-y-6">
              <h3 className="font-serif text-2xl md:text-3xl tracking-tight">
                Technical Specifications
              </h3>
              {specs.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 border-t border-foreground/5">
                  {specs.map((spec, index) => (
                    <div
                      key={`${spec.label}-${index}`}
                      className="flex justify-between items-start py-4 gap-4 border-b border-foreground/5 min-w-0"
                    >
                      <span className="uppercase tracking-[0.2em] text-[10px] font-bold opacity-80 shrink-0">
                        {spec.label}
                      </span>
                      <span className="uppercase tracking-widest text-[10px] font-bold text-right wrap-break-word min-w-0">
                        {spec.value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-foreground/50">
                  No technical specifications listed for this product.
                </p>
              )}

              {specTable && specTable.rows.length > 0 ? (
                <div className="space-y-3 pt-2">
                  {specTable.caption ? (
                    <h4 className="text-sm font-bold text-foreground">
                      {specTable.caption}
                    </h4>
                  ) : null}
                  <div className="overflow-x-auto border border-foreground/10">
                    <table className="w-full min-w-max text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-foreground/10 bg-secondary/40">
                          {specTable.headings.map((heading, index) => (
                            <th
                              key={`${heading}-${index}`}
                              className="px-4 py-2.5 font-bold uppercase tracking-wide text-[10px] text-foreground/70 whitespace-nowrap"
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {specTable.rows.map((row, rowIndex) => (
                          <tr
                            key={rowIndex}
                            className="border-b border-foreground/5 last:border-0 odd:bg-transparent even:bg-secondary/15"
                          >
                            {row.map((cell, cellIndex) => (
                              <td
                                key={cellIndex}
                                className="px-4 py-2 text-foreground/80 whitespace-nowrap"
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>

            {schematicImage ? (
              <div className="space-y-6">
                <h3 className="text-xl font-serif tracking-widest uppercase">
                  Schematic & Dimensions
                </h3>
                {/\.pdf($|\?)/i.test(schematicImage) ||
                /\/explode\//i.test(schematicImage) ? (
                  <div className="relative w-full overflow-hidden border border-foreground/5 bg-white">
                    <iframe
                      src={
                        /pdf_js\/web\//i.test(schematicImage)
                          ? schematicImage
                          : `https://www.noken.com/pdf_js/web/mini.html?file=${encodeURIComponent(schematicImage)}`
                      }
                      title="Technical schematic"
                      className="w-full h-105 border-0"
                    />
                  </div>
                ) : (
                  <div className="relative aspect-square bg-secondary/30 flex items-center justify-center overflow-hidden border border-foreground/5">
                    <Image
                      src={schematicImage}
                      alt="Technical schematic"
                      fill
                      className="opacity-80 grayscale mix-blend-multiply object-contain"
                    />
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ),
    brochure: hasBrochure ? (
          <div className="animate-in fade-in duration-300 space-y-4">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Brochure
            </h2>
            <ul className="space-y-3 max-w-2xl">
              {brochures.map((b) => (
                <li key={`${b.name}-${b.url}`}>
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-70"
                  >
                    <FileText className="w-4 h-4" />
                    {b.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
    range: hasRange ? (
          <div className="animate-in fade-in duration-300 space-y-8">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Product Range
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {productRange.map((item, i) => (
                <button
                  key={`${item.name}-${i}`}
                  type="button"
                  onClick={() => setRangeModal(item)}
                  className="group text-left rounded-xl border border-foreground/10 overflow-hidden bg-white transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
                >
                  {item.image ? (
                    <div className="relative aspect-square bg-secondary/20">
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        className="object-contain p-3 transition-transform duration-300 group-hover:scale-[1.02]"
                        sizes="200px"
                      />
                    </div>
                  ) : (
                    <div className="aspect-square bg-secondary/20" />
                  )}
                  <div className="p-3">
                    <h3 className="text-xs font-bold uppercase tracking-wide">
                      {item.name}
                    </h3>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null,
    cases: hasCases ? (
          <div className="animate-in fade-in duration-300 space-y-6">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Case Studies
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {caseStudies.map((c, i) => (
                <article
                  key={`${c.name}-${i}`}
                  className="rounded-xl border border-foreground/10 overflow-hidden bg-white"
                >
                  {c.coverImage ? (
                    <div className="relative aspect-4/3 bg-secondary/30">
                      <Image
                        src={c.coverImage}
                        alt={c.name}
                        fill
                        className="object-cover"
                        sizes="33vw"
                      />
                    </div>
                  ) : null}
                  <div className="p-4 space-y-2">
                    <h3 className="text-sm font-bold">{c.name}</h3>
                    {c.file ? (
                      <a
                        href={c.file}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-primary underline"
                      >
                        Download PDF
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null,
    general: hasGeneral ? (
          <div className="animate-in fade-in duration-300 grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="space-y-4">
              <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
                General Specification
              </h2>
              <p className="text-sm md:text-[15px] leading-[1.8] text-foreground/75 whitespace-pre-line">
                {generalSpecification?.content}
              </p>
            </div>
            {generalSpecification?.image ? (
              <div className="relative aspect-square border border-foreground/5 bg-secondary/20">
                <Image
                  src={generalSpecification.image}
                  alt="General specification"
                  fill
                  className="object-contain p-4"
                />
              </div>
            ) : null}
          </div>
        ) : null,
    suitability: hasSuitabilityTab && suitability ? (
          <div className="animate-in fade-in duration-300 space-y-6">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Suitability
            </h2>
            {suitability.type === "image" && suitability.image ? (
              <div className="relative w-full max-w-xl aspect-460/372 border border-foreground/10 bg-white">
                <Image
                  src={suitability.image}
                  alt="Suitability"
                  fill
                  className="object-contain p-2"
                  sizes="(max-width: 768px) 100vw, 512px"
                />
              </div>
            ) : null}
            {suitability.type === "table" && suitability.tableRows?.length ? (
              <div className="overflow-x-auto max-w-3xl border border-foreground/15 bg-white">
                <table className="w-full text-sm border-collapse">
                  {suitability.tableHeadings?.some(Boolean) ? (
                    <thead>
                      <tr className="border-b border-foreground/15">
                        {suitability.tableHeadings.map((h, i) => (
                          <th
                            key={`${h}-${i}`}
                            className="text-left py-2.5 px-3 font-bold uppercase tracking-wide text-xs"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {suitability.tableRows.map((row, ri) => (
                      <tr
                        key={ri}
                        className="border-b border-foreground/10 last:border-b-0"
                      >
                        {row.map((cell, ci) => (
                          <td key={ci} className="py-2.5 px-3 align-top">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null,
    installer: hasInstallerGuides ? (
          <div className="animate-in fade-in duration-300 space-y-4">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Installer Guide
            </h2>
            <ul className="space-y-3 max-w-2xl">
              {installerGuides.map((g) => (
                <li key={`${g.name}-${g.url}`}>
                  <a
                    href={g.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-semibold hover:opacity-70"
                  >
                    <FileText className="w-4 h-4" />
                    {g.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
    warranty: hasWarranty ? (
          <div className="animate-in fade-in duration-300 space-y-4">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Warranty
            </h2>
            <ul className="space-y-3 max-w-2xl">
              {warrantyFiles.map((w) => (
                <li key={`${w.name}-${w.url}`}>
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-semibold hover:opacity-70"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {w.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
    drawings: hasDrawings ? (
          <div className="animate-in fade-in duration-300 space-y-4">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Technical Drawings
            </h2>
            <div className="overflow-x-auto border border-foreground/10 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-foreground/10 bg-secondary/30">
                    <th className="text-left p-3 text-[11px] uppercase tracking-wide">
                      Ref
                    </th>
                    <th className="text-left p-3 text-[11px] uppercase tracking-wide">
                      Description
                    </th>
                    <th className="text-left p-3 text-[11px] uppercase tracking-wide">
                      Files
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {drawingEntries.map((d, i) => (
                    <tr
                      key={`${d.ref}-${i}`}
                      className="border-b border-foreground/5"
                    >
                      <td className="p-3 font-semibold whitespace-nowrap">
                        {d.ref}
                      </td>
                      <td className="p-3 text-foreground/75">{d.description}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {(d.files || []).map((f) => (
                            <a
                              key={`${f.name}-${f.url}`}
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-bold uppercase tracking-wide text-primary underline"
                            >
                              {f.name || "File"}
                            </a>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null,
    install: hasInstall ? (
          <div className="animate-in fade-in duration-300 space-y-4">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Installation guide
            </h2>
            <p className="text-sm md:text-[15px] leading-[1.8] text-foreground/75 whitespace-pre-line">
              {installationGuide}
            </p>
          </div>
        ) : null,
    flashing: hasFinder ? (
          <div className="animate-in fade-in duration-300 space-y-6">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Flashing Finder
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {flashingFinder.map((item, index) => (
                <article
                  key={`${item.title}-${index}`}
                  className="rounded-xl border border-foreground/10 overflow-hidden bg-white"
                >
                  {item.imageUrl ? (
                    <div className="relative aspect-4/3 bg-secondary/30">
                      <Image
                        src={item.imageUrl}
                        alt={item.title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 33vw"
                      />
                    </div>
                  ) : null}
                  <div className="p-4 space-y-2">
                    <h3 className="text-sm font-bold text-foreground">
                      {item.title}
                    </h3>
                    {item.description ? (
                      <p className="text-sm text-foreground/65 leading-relaxed">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null,
    maintenance: hasMaintenance ? (
          <div className="animate-in fade-in duration-300 space-y-6">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Maintenance
            </h2>
            {renderHtmlOrText(maintenance?.html)}
            {(maintenance?.images || []).length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {maintenance!.images!.slice(0, 12).map((src, i) => (
                  <div
                    key={`${src}-${i}`}
                    className="relative aspect-4/3 bg-secondary/30 rounded-md overflow-hidden"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null,
    reviews: (
          <div className="animate-in fade-in duration-300">
            <ProductReviewsPanel
              productId={productId}
              reviews={reviews}
              averageRating={averageRating}
              reviewCount={reviewCount}
            />
          </div>
        ),
  };

  return (
    <section
      id="product-detail-tabs"
      className="mt-20 scroll-mt-28 border-t border-foreground/10 px-4 md:mt-28 md:px-[4.375rem]"
    >
      {/*
        The reference closes its product information with an accordion list
        rather than a tab bar — Description, Specification, Technical
        Information, Guarantees, Shipping & Returns, Order a Sample, each
        under its own outlined header (.product__accordions). Every section
        we had is still here with its content intact; only the way they are
        revealed has changed.
      */}
      {visibleTabs.map((tab) => {
        const panel = PANELS[tab.key];
        if (!panel) return null;
        const isOpen = active === tab.key;
        const Icon = tab.icon;
        return (
          <div key={tab.key} className="border-b border-foreground/10">
            <button
              type="button"
              onClick={() => setActive(isOpen ? "" : tab.key)}
              aria-expanded={isOpen}
              className="font-menu flex w-full items-center justify-between gap-4 py-5 text-left text-[12px] font-medium uppercase leading-[1.2] tracking-[1.4px] text-black"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {tab.label}
                {tab.key === "reviews" && reviewCount > 0 ? (
                  <span className="font-normal tracking-normal text-black/40">
                    ({reviewCount})
                  </span>
                ) : null}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen ? <div className="pb-10">{panel}</div> : null}
          </div>
        );
      })}
    </section>
  );
}

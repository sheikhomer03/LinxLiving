"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Box, FileText, Mail, Phone, Star, Wrench, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductReviewsPanel } from "@/components/products/ProductReviews";
import { OPEN_PRODUCT_REVIEWS_EVENT } from "@/components/products/ProductRatingSummary";
import type { FlashingFinderItem } from "@/lib/productExtras";

type SpecItem = { label: string; value: string };

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
  specs: SpecItem[];
  showSpecs: boolean;
  schematicImage?: string;
  reviews: ReviewItem[];
  averageRating: number;
  reviewCount: number;
  installationGuide?: string | null;
  flashingFinder?: FlashingFinderItem[];
}

type TabKey = "description" | "specs" | "install" | "flashing" | "reviews";

export function ProductDetailTabs({
  productId,
  description,
  specs,
  showSpecs,
  schematicImage,
  reviews,
  averageRating,
  reviewCount,
  installationGuide,
  flashingFinder = [],
}: ProductDetailTabsProps) {
  const hasInstall = Boolean(String(installationGuide || "").trim());
  const hasFinder = flashingFinder.length > 0;

  const tabs: {
    key: TabKey;
    label: string;
    icon: typeof FileText;
    hidden?: boolean;
  }[] = [
    { key: "description", label: "Job Description", icon: FileText },
    {
      key: "specs",
      label: "Technical Spec's",
      icon: Box,
      hidden: !showSpecs,
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
    { key: "reviews", label: "Review", icon: Star },
  ];

  const visibleTabs = tabs.filter((t) => !t.hidden);
  const [active, setActive] = useState<TabKey>(
    visibleTabs[0]?.key || "description",
  );

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

  return (
    <section
      id="product-detail-tabs"
      className="mt-20 md:mt-28 pt-10 border-t border-foreground/10 scroll-mt-28"
    >
      <div className="flex flex-wrap gap-0 border-b border-foreground/10">
        {visibleTabs.map((tab) => {
          const isActive = active === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={cn(
                "relative inline-flex items-center gap-2 px-4 sm:px-6 py-4 text-[11px] sm:text-[12px] uppercase tracking-[0.14em] font-bold transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-foreground/45 hover:text-foreground/70",
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {tab.label}
              {tab.key === "reviews" && reviewCount > 0 ? (
                <span className="text-foreground/40 font-medium normal-case tracking-normal">
                  ({reviewCount})
                </span>
              ) : null}
              <span
                className={cn(
                  "absolute left-0 right-0 bottom-0 h-[2px] transition-colors",
                  isActive ? "bg-foreground" : "bg-transparent",
                )}
              />
            </button>
          );
        })}
      </div>

      <div className="py-10 md:py-14">
        {active === "description" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 animate-in fade-in duration-300">
            <div className="lg:col-span-7 space-y-6">
              <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
                Job Description
              </h2>
              {(() => {
                const paragraphs = String(description || "")
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean);
                if (!paragraphs.length) {
                  return (
                    <p className="text-sm md:text-[15px] leading-[1.8] text-foreground/75 font-sans max-w-4xl">
                      No description available for this product.
                    </p>
                  );
                }
                const [lead, ...rest] = paragraphs;
                const bullets = rest.filter((p) => p.length > 20);
                return (
                  <div className="space-y-5 max-w-4xl font-sans">
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
            <div className="lg:col-span-5 space-y-6">
              <h3 className="text-[13px] uppercase tracking-[0.2em] font-bold text-foreground/80">
                Got a Question?
              </h3>
              <div className="space-y-3">
                <Link
                  href="mailto:info@linxliving.co.uk"
                  className="w-full border border-foreground/10 py-5 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 transition-all group"
                >
                  <Mail className="w-3.5 h-3.5 opacity-80" />
                  Contact Us
                </Link>
                <Link
                  href="tel:02046342203"
                  className="w-full border border-foreground/10 py-5 flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 transition-all group"
                >
                  <Phone className="w-3.5 h-3.5 opacity-80" />
                  Call us on 020 4634 2203
                </Link>
              </div>
            </div>
          </div>
        )}

        {active === "specs" && showSpecs && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start animate-in fade-in duration-300">
            <div className="space-y-6">
              <h3 className="font-serif text-2xl md:text-3xl tracking-tight">
                Technical Spec&apos;s
              </h3>
              {specs.length > 0 ? (
                <div className="divide-y divide-foreground/5 border-t border-foreground/5">
                  {specs.map((spec, index) => (
                    <div
                      key={`${spec.label}-${index}`}
                      className="flex justify-between py-4 items-center gap-4"
                    >
                      <span className="uppercase tracking-[0.2em] text-[10px] font-bold opacity-80">
                        {spec.label}
                      </span>
                      <span className="uppercase tracking-widest text-[10px] font-bold text-right">
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
            </div>

            {schematicImage ? (
              <div className="space-y-6">
                <h3 className="text-xl font-serif tracking-widest uppercase">
                  Schematic & Dimensions
                </h3>
                <div className="relative aspect-square bg-secondary/30 flex items-center justify-center overflow-hidden border border-foreground/5">
                  <Image
                    src={schematicImage}
                    alt="Technical schematic"
                    fill
                    className="opacity-80 grayscale mix-blend-multiply object-contain"
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}

        {active === "install" && hasInstall ? (
          <div className="max-w-3xl animate-in fade-in duration-300 space-y-4">
            <h2 className="font-serif text-2xl md:text-3xl tracking-tight">
              Installation guide
            </h2>
            <p className="text-sm md:text-[15px] leading-[1.8] text-foreground/75 whitespace-pre-line">
              {installationGuide}
            </p>
          </div>
        ) : null}

        {active === "flashing" && hasFinder ? (
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
                    <div className="relative aspect-[4/3] bg-secondary/30">
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
        ) : null}

        {active === "reviews" && (
          <div className="animate-in fade-in duration-300">
            <ProductReviewsPanel
              productId={productId}
              reviews={reviews}
              averageRating={averageRating}
              reviewCount={reviewCount}
            />
          </div>
        )}
      </div>
    </section>
  );
}

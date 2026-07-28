"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Box, FileText, Mail, Phone, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductReviewsPanel } from "@/components/products/ProductReviews";

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
}

type TabKey = "description" | "specs" | "reviews";

export function ProductDetailTabs({
  productId,
  description,
  specs,
  showSpecs,
  schematicImage,
  reviews,
  averageRating,
  reviewCount,
}: ProductDetailTabsProps) {
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
    { key: "reviews", label: "Review", icon: Star },
  ];

  const visibleTabs = tabs.filter((t) => !t.hidden);
  const [active, setActive] = useState<TabKey>(
    visibleTabs[0]?.key || "description",
  );

  return (
    <section className="mt-20 md:mt-28 pt-10 border-t border-foreground/10">
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
              <p className="text-sm md:text-[15px] leading-[1.8] text-foreground/75 font-sans max-w-4xl whitespace-pre-line">
                {description || "No description available for this product."}
              </p>
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
                  {specs.map((spec) => (
                    <div
                      key={spec.label}
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

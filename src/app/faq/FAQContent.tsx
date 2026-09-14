"use client";

import { Footer } from "@/components/layout/Footer";
import { PageBanner } from "@/components/layout/PageBanner";
import { useState, useEffect, type ReactNode } from "react";
import { Plus, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoreName } from "@/app/actions/settings";
import Link from "next/link";

const BANNER_IMAGE = "/home/hero/heated-bathroom.png";

/** The page's small caps, as on /about and /contact. */
const EYEBROW =
  "font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/45 lg:text-[10px]";

const getFAQS = (storeName: string) => [
  {
    question: "How do I request a physical material sample?",
    answer:
      "You can request samples directly from each product page or by contacting our studio team. We provide curated sample kits that showcase the texture, veining, and finish of our premium materials.",
  },
  {
    question: "Do you offer international architectural consultation?",
    answer: `Yes, ${storeName} provides global design services. Our consultants are experienced in international building codes and logistics, ensuring seamless project execution across borders.`,
  },
  {
    question: "What are the maintenance requirements for premium stone?",
    answer:
      "Every selection includes a detailed care guide. Generally, we recommend periodic sealing for porous stones and the use of pH-neutral cleaners to preserve the natural integrity of the surface.",
  },
  {
    question: "How long is the production lead time for custom pieces?",
    answer:
      "Standard production for custom al pieces is typically 6-10 weeks. This includes selection, crafting, and quality assessment before shipping.",
  },
];

export default function FAQContent({ navbar }: { navbar: ReactNode }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [storeName, setStoreName] = useState("Linx Square");

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  const faqs = getFAQS(storeName);

  return (
    <main className="min-h-screen bg-background">
      {navbar}

      {/* `standard` rather than the catalogue index's full height: the answers
          are what the visitor came for, and 720px of photography puts the first
          one two screenfuls down. */}
      <PageBanner
        image={BANNER_IMAGE}
        title="Frequently Asked"
        size="standard"
      />

      <section className="px-4 py-12 lg:px-8 lg:py-16">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <aside className="lg:col-span-4 self-start lg:sticky lg:top-32">
            <p className={EYEBROW}>On this page</p>
            <nav className="mt-6 border-t border-black/10">
              {faqs.map((faq, index) => (
                <a
                  key={`faq-link-${index}`}
                  href={`#faq-${index}`}
                  onClick={() => setOpenIndex(index)}
                  className={cn(
                    "block border-b border-black/10 py-4 text-[13px] leading-snug transition-colors hover:text-foreground",
                    openIndex === index
                      ? "text-foreground"
                      : "text-foreground/55",
                  )}
                >
                  {faq.question}
                </a>
              ))}
            </nav>

            <div className="mt-10 border border-black/10 p-6">
              <p className={EYEBROW}>Still have questions?</p>
              <p className="mt-3 text-[13px] leading-relaxed text-foreground/70">
                Our specialists are available for more detailed enquiries.
              </p>
              <Link
                href="/contact"
                className="group mt-4 inline-block font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-foreground lg:text-[10px]"
              >
                Contact us
                <ArrowRight className="ml-2 inline-block h-3 w-3 shrink-0 align-middle transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </aside>

          <div className="lg:col-span-8">
            <div className="border-t border-black/10">
              {faqs.map((faq, index) => {
                const open = openIndex === index;
                return (
                  <div
                    key={index}
                    id={`faq-${index}`}
                    className="border-b border-black/10 scroll-mt-32"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenIndex(open ? null : index)}
                      aria-expanded={open}
                      className="group flex w-full items-start justify-between gap-6 py-6 text-left"
                    >
                      <span className="text-[13px] font-medium uppercase leading-snug tracking-[0.08em] text-foreground sm:text-sm">
                        {faq.question}
                      </span>
                      {/* One glyph, rotated — a plus that becomes a minus.
                          Swapping two icons made the control jump as the row
                          re-measured. */}
                      <Plus
                        aria-hidden
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0 stroke-[1.5] text-foreground/45 transition-transform duration-300 group-hover:text-foreground",
                          open && "rotate-45",
                        )}
                      />
                    </button>
                    <div
                      className={cn(
                        "grid transition-[grid-template-rows] duration-400 ease-out",
                        // Rows rather than max-height: a fixed max-height either
                        // clips a long answer or animates dead space above a
                        // short one.
                        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                      )}
                    >
                      <div className="overflow-hidden">
                        <p className="pb-6 pr-10 text-[13px] leading-relaxed text-foreground/70 sm:text-sm">
                          {faq.answer}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}

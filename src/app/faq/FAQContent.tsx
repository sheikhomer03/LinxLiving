"use client";

import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { useState, useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoreName } from "@/app/actions/settings";
import Link from "next/link";

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
    <main className="min-h-screen bg-secondary/20">
      {navbar}
      <PageHeader
        title="Frequently Asked"
        description="Common inquiries regarding our materials, logistics, and  services."
        breadcrumb={[{ label: "FAQ", href: "/faq" }]}
      />

      <div className="site-container pt-0 pb-16 md:pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-10 lg:gap-14">
          {/* Table of contents / sidebar */}
          <aside className="lg:col-span-1">
            <div className="space-y-6 lg:sticky lg:top-52">
              <div className="bg-white border border-foreground/10 p-6 space-y-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
                  On this page
                </p>
                <nav className="space-y-3">
                  {faqs.map((faq, index) => (
                    <a
                      key={`faq-link-${index}`}
                      href={`#faq-${index}`}
                      onClick={() => setOpenIndex(index)}
                      className="block text-sm text-foreground/70 hover:text-primary transition-colors"
                    >
                      {faq.question}
                    </a>
                  ))}
                </nav>
              </div>

              <div className="bg-white border border-foreground/10 p-6 space-y-3 shadow-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-foreground/50">
                  Still have questions?
                </p>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  Our specialists are available for more detailed inquiries.
                </p>
                <Link
                  href="/contact"
                  className="inline-block text-[10px] uppercase tracking-[0.2em] font-bold text-primary hover:text-foreground transition-colors"
                >
                  Contact us →
                </Link>
              </div>
            </div>
          </aside>

          {/* FAQ content */}
          <div className="lg:col-span-3">
            <div className="bg-white border border-foreground/10 p-8 sm:p-12 shadow-sm">
              <div className="space-y-0">
                {faqs.map((faq, index) => (
                  <div
                    key={index}
                    id={`faq-${index}`}
                    className="border-b border-foreground/10 last:border-none scroll-mt-52"
                  >
                    <button
                      onClick={() =>
                        setOpenIndex(openIndex === index ? null : index)
                      }
                      className="w-full py-8 flex justify-between items-center text-left hover:text-primary transition-all group"
                    >
                      <span className="text-xl tracking-tight uppercase group-hover:translate-x-1 transition-transform">
                        {faq.question}
                      </span>
                      {openIndex === index ? (
                        <ChevronUp className="w-5 h-5 text-primary shrink-0 ml-4" />
                      ) : (
                        <ChevronDown className="w-5 h-5 opacity-40 group-hover:opacity-100 group-hover:text-primary transition-all shrink-0 ml-4" />
                      )}
                    </button>
                    <div
                      className={cn(
                        "overflow-hidden transition-all duration-500",
                        openIndex === index ? "max-h-96 pb-8" : "max-h-0",
                      )}
                    >
                      <p className="text-muted-foreground leading-relaxed text-lg">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}

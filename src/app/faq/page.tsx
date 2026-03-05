"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { useState, useEffect } from "react";
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

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [storeName, setStoreName] = useState("Linx Living");

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title="Frequently Asked"
        description="Common inquiries regarding our materials, logistics, and  services."
        breadcrumb={[{ label: "FAQ", href: "/faq" }]}
      />

      <section className="py-24 px-6 lg:px-20 max-w-3xl mx-auto">
        <div className="space-y-4">
          {getFAQS(storeName).map((faq, index) => (
            <div
              key={index}
              className="border-b border-foreground/10 last:border-none"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full py-8 flex justify-between items-center text-left hover:opacity-100 transition-opacity"
              >
                <span className="text-xl tracking-tight uppercase">
                  {faq.question}
                </span>
                {openIndex === index ? (
                  <ChevronUp className="w-5 h-5 opacity-40" />
                ) : (
                  <ChevronDown className="w-5 h-5 opacity-40" />
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

        <div className="mt-24 p-12 bg-secondary/30 text-center space-y-8">
          <p className="uppercase tracking-[0.4em] text-[10px] font-bold opacity-40">
            Still have questions?
          </p>
          <p className="text-lg leading-relaxed italic">
            "Our specialists are available for more detailed inquiries."
          </p>
          <Link href="/contact">
            <button className="bg-foreground text-background px-10 py-4 uppercase tracking-widest text-[10px] font-bold hover:bg-accent hover:text-foreground transition-all">
              Get in Contact
            </button>
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}

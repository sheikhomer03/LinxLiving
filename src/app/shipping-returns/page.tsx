import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shipping & Returns | Luxury Material Logistics",
  description: "Secure and transparent logistics for your premium selections. Learn about our white-glove delivery and international shipping services.",
  alternates: {
    canonical: "/shipping-returns",
  },
};
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { getStoreName } from "@/app/actions/settings";
import Link from "next/link";

function buildSections(storeName: string) {
  return [
    {
      id: "white-glove-delivery",
      title: "1. Complimentary White-Glove Delivery",
      body: "We provide comprehensive white-glove delivery for all large format stone and al pieces. Our specialized team handles every aspect of transport and placement within your residence.",
    },
    {
      id: "shipping-timelines",
      title: "2. Shipping Timelines",
      body: "Stocked items are dispatched within 3-5 business days. Custom crafted pieces and large format slabs typically require 4-12 weeks for production and delivery, depending on the material's origin.",
    },
    {
      id: "global-distribution",
      title: "3. Global Distribution",
      body: `${storeName.toUpperCase()} coordinates international logistics to any location worldwide. Detailed tracking and insurance are included with every shipment to ensure the integrity of your selected materials.`,
    },
    {
      id: "policy-of-returns",
      title: "4. Policy of Returns",
      body: "Due to the unique nature of our premium stones and custom creations, returns are accepted within 14 days of receipt for in-stock items in original condition. Custom designs and modified slabs are non-returnable.",
    },
  ];
}

export default async function ShippingReturnsPage() {
  const storeName = await getStoreName();
  const sections = buildSections(storeName);

  return (
    <main className="min-h-screen bg-secondary/20">
      <StorefrontNavbar />
      <PageHeader
        title="Shipping & Returns"
        description="Transparent and secure logistics for your premium selections."
        breadcrumb={[{ label: "Shipping", href: "/shipping-returns" }]}
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
                  {sections.map((section) => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className="block text-sm text-foreground/70 hover:text-primary transition-colors"
                    >
                      {section.title}
                    </a>
                  ))}
                </nav>
              </div>

              <div className="bg-white border border-foreground/10 p-6 space-y-3 shadow-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-foreground/50">
                  Questions regarding logistics?
                </p>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  Our dedicated logistics managers are available to discuss
                  specific site requirements or international shipping
                  arrangements.
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

          {/* Shipping & returns content */}
          <div className="lg:col-span-3">
            <div className="bg-white border border-foreground/10 p-8 sm:p-12 shadow-sm space-y-14">
              {sections.map((section) => (
                <div
                  key={section.id}
                  id={section.id}
                  className="space-y-6 scroll-mt-52"
                >
                  <h2 className="text-xl sm:text-2xl font-serif tracking-tight uppercase border-l-2 border-primary pl-4 sm:pl-8 text-primary wrap-break-word">
                    {section.title}
                  </h2>
                  <p className="pl-4 sm:pl-8 text-foreground/80 leading-relaxed text-base sm:text-lg wrap-break-word">
                    {section.body}
                  </p>
                </div>
              ))}

              <div className="pl-8 pt-6 border-t border-foreground/10 text-[10px] uppercase tracking-[0.3em] font-bold text-foreground/50">
                Last Updated: January 2026
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}

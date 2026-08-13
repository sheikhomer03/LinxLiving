import Link from "next/link";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms & Conditions | Linx Square",
  description: "The legal framework for our boutique services and transactions.",
  robots: {
    index: false,
    follow: true,
  },
};
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { getStoreName } from "@/app/actions/settings";

function buildSections(storeName: string) {
  return [
    {
      id: "boutique-agreement",
      title: "1. Boutique Agreement",
      body: `By engaging with ${storeName.toUpperCase()}, you agree to the following conditions regarding procurement, crafting, and project consultation.`,
    },
    {
      id: "ownership",
      title: "2. Ownership & Copyright",
      body: `All designs, material configurations, and brand assets presented on this platform are the intellectual property of ${storeName.toUpperCase()}.`,
    },
    {
      id: "material-variation",
      title: "3. Material Variation",
      body: "Due to the natural origin of our premium stone and hand-crafted nature of our ceramics, variations in veining, color, and texture are inherent features and not considered defects.",
    },
  ];
}

export default async function TermsConditionsPage() {
  const storeName = await getStoreName();
  const sections = buildSections(storeName);

  return (
    <main className="min-h-screen bg-secondary/20">
      <StorefrontNavbar />
      <PageHeader
        title="Terms & Conditions"
        description="The legal framework for our boutique services and transactions."
        breadcrumb={[{ label: "Terms", href: "/terms" }]}
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
                  Questions?
                </p>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  Get in touch with our team for anything not covered here.
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

          {/* Terms content */}
          <div className="lg:col-span-3">
            <div className="bg-white border border-foreground/10 p-8 sm:p-12 shadow-sm space-y-14">
              {sections.map((section) => (
                <div
                  key={section.id}
                  id={section.id}
                  className="space-y-6 scroll-mt-52"
                >
                  <h2 className="text-2xl font-serif tracking-tight uppercase border-l-2 border-primary pl-8 text-primary">
                    {section.title}
                  </h2>
                  <p className="pl-8 text-foreground/80 leading-relaxed text-lg">
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

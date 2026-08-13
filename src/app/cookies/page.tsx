import Link from "next/link";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookies Policy | Linx Square",
  description: "Understanding our digital stewardship and platform optimization.",
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
      id: "digital-presence",
      title: "1. Digital Presence",
      body: `We use refined digital tools known as cookies to enhance your experience on the ${storeName} platform. These tools allow us to remember your preferred materials, currency settings, and collection selections.`,
    },
    {
      id: "essential-cookies",
      title: "2. Essential Cookies",
      body: "Required for core functionality, such as collection persistence, your cart, and currency settings. These cookies cannot be switched off in our systems.",
      status: "Always Active",
    },
    {
      id: "analytics-tools",
      title: "3. Analytics Tools",
      body: "Helping us understand which collections resonate most with our clients, so we can continue to refine the range and the site experience.",
      action: "Manage Preferences",
    },
  ];
}

export default async function CookiesPage() {
  const storeName = await getStoreName();
  const sections = buildSections(storeName);

  return (
    <main className="min-h-screen bg-secondary/20">
      <StorefrontNavbar />
      <PageHeader
        title="Cookies Policy"
        description="Understanding our digital stewardship and platform optimization."
        breadcrumb={[{ label: "Cookies", href: "/cookies" }]}
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
                  Questions about cookies?
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

          {/* Cookies content */}
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
                  {section.status ? (
                    <div className="pl-8">
                      <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-foreground/60 border border-foreground/15 px-3 py-1.5">
                        {section.status}
                      </span>
                    </div>
                  ) : null}
                  {section.action ? (
                    <div className="pl-8">
                      <button
                        type="button"
                        className="text-[10px] font-bold uppercase tracking-widest underline underline-offset-4 hover:text-primary transition-colors"
                      >
                        {section.action}
                      </button>
                    </div>
                  ) : null}
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

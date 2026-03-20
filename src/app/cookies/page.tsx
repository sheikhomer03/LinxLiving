import { Navbar } from "@/components/layout/Navbar";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookies Policy | Linx Living",
  description: "Understanding our digital stewardship and platform optimization.",
  robots: {
    index: false,
    follow: true,
  },
};
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { getStoreName } from "@/app/actions/settings";

export default async function CookiesPage() {
  const storeName = await getStoreName();
  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title="Cookies Policy"
        description="Understanding our digital stewardship and platform optimization."
        breadcrumb={[{ label: "Cookies", href: "/cookies" }]}
      />

      <section className="py-24 px-6 lg:px-20 max-w-3xl mx-auto space-y-12">
        <h2 className="text-2xl font-serif tracking-tight uppercase">
          Digital Presence
        </h2>

        <p className="text-muted-foreground leading-relaxed text-lg">
          We use refined digital tools known as cookies to enhance your
          experience on the {storeName} platform. These tools allow us to
          remember your preferred materials, currency settings, and collection
          selections.
        </p>

        <div className="space-y-8 pt-8">
          <div className="flex justify-between items-center py-6 border-b border-foreground/5">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest">
                Essential Cookies
              </h3>
              <p className="text-xs text-muted-foreground mt-1 lowercase italic">
                Required for core functionality, such as collection persistence.
              </p>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">
              Always Active
            </div>
          </div>

          <div className="flex justify-between items-center py-6 border-b border-foreground/5">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest">
                Analytics Tools
              </h3>
              <p className="text-xs text-muted-foreground mt-1 lowercase italic">
                Helping us understand which collections resonate most with our
                clients.
              </p>
            </div>
            <button className="text-[10px] font-bold uppercase tracking-widest underline underline-offset-4">
              Manage Preferences
            </button>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

import { Navbar } from "@/components/layout/Navbar";
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

export default async function TermsConditionsPage() {
  const storeName = await getStoreName();
  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title="Terms & Conditions"
        description="The legal framework for our boutique services and transactions."
        breadcrumb={[{ label: "Terms", href: "/terms" }]}
      />

      <section className="py-24 px-6 lg:px-20 max-w-3xl mx-auto space-y-16">
        <div className="space-y-6">
          <h2 className="text-2xl font-serif tracking-tight uppercase">
            Boutique Agreement
          </h2>
          <p className="text-muted-foreground leading-relaxed text-lg">
            By engaging with {storeName.toUpperCase()}, you agree to the
            following conditions regarding procurement, crafting, and project
            consultation.
          </p>
        </div>

        <div className="space-y-12">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-widest">
              Ownership & Copyright
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              All designs, material configurations, and brand assets presented
              on this platform are the intellectual property of{" "}
              {storeName.toUpperCase()}.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-widest">
              Material Variation
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Due to the natural origin of our premium stone and hand-crafted
              nature of our ceramics, variations in veining, color, and texture
              are inherent features and not considered defects.
            </p>
          </div>
        </div>

        <div className="pt-20 text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
          Last Updated: January 2026
        </div>
      </section>

      <Footer />
    </main>
  );
}

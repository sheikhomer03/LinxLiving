import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { getStoreName } from "@/app/actions/settings";

export default async function PrivacyPolicyPage() {
  const storeName = await getStoreName();
  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title="Privacy Policy"
        description="How we safeguard your personal and project information."
        breadcrumb={[{ label: "Privacy", href: "/privacy" }]}
      />

      <section className="py-24 px-6 lg:px-20 max-w-3xl mx-auto prose prose-luxury">
        <div className="space-y-12">
          <div className="space-y-6">
            <h2 className="text-2xl font-serif tracking-tight uppercase">
              1. Introduction
            </h2>
            <p className="text-muted-foreground leading-relaxed text-lg">
              At {storeName.toUpperCase()}, your privacy is paramount. We are
              committed to protecting the integrity of the data you share with
              us during your architectural material selection and procurement
              journey.
            </p>
          </div>

          <div className="space-y-6">
            <h2 className="text-2xl font-serif tracking-tight uppercase">
              2. Information We Collect
            </h2>
            <p className="text-muted-foreground leading-relaxed text-lg">
              We collect information essential to providing our premium
              services, including project specifications, delivery addresses,
              and contact details for consultation purposes.
            </p>
          </div>

          <div className="space-y-6">
            <h2 className="text-2xl font-serif tracking-tight uppercase">
              3. Data Usage
            </h2>
            <p className="text-muted-foreground leading-relaxed text-lg">
              Your information is exclusively used to facilitate your orders,
              manage logistics, and provide personalized design consultation. We
              do not sell or trade your data to third parties.
            </p>
          </div>

          <div className="pt-20 text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
            Last Updated: January 2026
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

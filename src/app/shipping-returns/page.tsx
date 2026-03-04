import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { getStoreName } from "@/app/actions/settings";

export default async function ShippingReturnsPage() {
  const storeName = await getStoreName();

  const policies = [
    {
      title: "Complimentary White-Glove Delivery",
      content:
        "We provide comprehensive white-glove delivery for all large format stone and al pieces. Our specialized team handles every aspect of transport and placement within your residence.",
    },
    {
      title: "Shipping Timelines",
      content:
        "Stocked items are dispatched within 3-5 business days. Custom crafted pieces and large format slabs typically require 4-12 weeks for production and delivery, depending on the material's origin.",
    },
    {
      title: "Global Distribution",
      content: `${storeName.toUpperCase()} coordinates international logistics to any location worldwide. Detailed tracking and insurance are included with every shipment to ensure the integrity of your selected materials.`,
    },
    {
      title: "Policy of Returns",
      content:
        "Due to the unique nature of our premium stones and custom creations, returns are accepted within 14 days of receipt for in-stock items in original condition. Custom designs and modified slabs are non-returnable.",
    },
  ];

  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title="Shipping & Returns"
        description="Transparent and secure logistics for your premium selections."
        breadcrumb={[{ label: "Shipping", href: "/shipping-returns" }]}
      />

      <section className="py-24 px-6 lg:px-20 max-w-4xl mx-auto space-y-20">
        {policies.map((policy) => (
          <div key={policy.title} className="space-y-6">
            <h2 className="text-2xl font-serif tracking-tight uppercase border-l-2 border-foreground pl-8">
              {policy.title}
            </h2>
            <p className="text-muted-foreground leading-relaxed text-lg pl-8">
              {policy.content}
            </p>
          </div>
        ))}

        <div className="bg-secondary/30 p-12 border border-foreground/5 space-y-8">
          <h3 className="text-sm font-bold uppercase tracking-[0.4em] opacity-40">
            Questions Regarding Logistics?
          </h3>
          <p className="text-sm leading-relaxed">
            Our dedicated logistics managers are available to discuss specific
            site requirements or international shipping arrangements.
          </p>
          <button className="bg-foreground text-background px-10 py-4 uppercase tracking-widest text-[10px] font-bold hover:bg-accent hover:text-foreground transition-all">
            Contact Logistics Team
          </button>
        </div>
      </section>

      <Footer />
    </main>
  );
}

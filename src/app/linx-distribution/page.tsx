import type { Metadata } from "next";
import { Package, Tag, Factory, Truck, Ship, CheckCircle2 } from "lucide-react";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { DistributionEnquiryForm } from "@/components/distribution/DistributionEnquiryForm";
import { getStoreName } from "@/app/actions/settings";

export const metadata: Metadata = {
  title: "LINX Square Distribution | Direct Tile Supply from India to the UK",
  description:
    "LINX Square Distribution supplies high-quality tiles manufactured in India directly to UK businesses, developers, retailers, merchants and trade customers.",
  alternates: { canonical: "/linx-distribution" },
};

const WHOLESALE_STATS = [
  { icon: Package, label: "Minimum order", value: "8,500 m²" },
  { icon: Tag, label: "Prices from", value: "£4.00 per m²" },
  { icon: Factory, label: "Production time", value: "10–20 days" },
  { icon: Truck, label: "Estimated delivery", value: "30–50 days" },
];

const COLLECTIONS = [
  "Porcelain tiles",
  "Floor tiles",
  "Wall tiles",
  "Outdoor porcelain",
  "Large-format tiles",
  "Marble-effect tiles",
  "Stone-effect tiles",
  "Wood-effect tiles",
  "Modern patterned tiles",
  "Commercial tile ranges",
];

const TRADE_CUSTOMERS = [
  "Tile retailers",
  "Builders’ merchants",
  "Flooring and tile companies",
  "Property developers",
  "Housebuilders",
  "Contractors",
  "Architects and designers",
  "Hotels and commercial developments",
  "Distributors and wholesalers",
];

const FORM_BENEFITS = [
  "Direct-to-trade pricing — no middleman markup",
  "Sourced from our own manufacturing range in India",
  "A dedicated distribution team for bulk & custom orders",
  "We aim to reply to every enquiry within 1 business day",
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-serif tracking-tight uppercase border-l-2 border-primary pl-8 text-primary">
      {children}
    </h2>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-foreground/10 p-8 sm:p-10 space-y-6 shadow-sm hover:shadow-md transition-shadow h-full">
      {children}
    </div>
  );
}

export default async function LinxDistributionPage() {
  const storeName = await getStoreName();

  return (
    <main className="min-h-screen bg-secondary/20">
      <StorefrontNavbar />
      <PageHeader
        title="LINX Square Distribution"
        description="Direct Tile Supply from India to the UK"
        breadcrumb={[{ label: "Distribution", href: "/linx-distribution" }]}
      />

      {/* Enquiry form — the page's primary conversion point, given full-bleed
          weight so it reads as the lead action rather than one panel among
          several. */}
      <section className="bg-[#0d0d0d] text-white">
        <div className="site-container py-16 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16 items-start">
            <div className="lg:col-span-2 space-y-8 lg:sticky lg:top-52">
              <div className="space-y-4">
                <p className="text-[11px] uppercase tracking-[0.35em] font-bold text-primary">
                  Request wholesale pricing
                </p>
                <h2 className="text-3xl md:text-4xl font-serif leading-[1.15]">
                  Looking for a Specific Design?
                </h2>
                <p className="text-white/70 leading-relaxed text-lg">
                  Tell us your size, finish, colour or design requirement and
                  estimated quantity — our distribution team will get back to
                  you with sourcing options and bulk pricing.
                </p>
              </div>
              <ul className="space-y-4">
                {FORM_BENEFITS.map((benefit) => (
                  <li key={benefit} className="flex gap-3 items-start">
                    <CheckCircle2
                      className="w-5 h-5 text-primary shrink-0 mt-0.5"
                      strokeWidth={1.6}
                    />
                    <span className="text-white/80 text-sm leading-relaxed">
                      {benefit}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-3">
              <div className="bg-white p-8 sm:p-12 shadow-2xl space-y-8">
                <div className="space-y-1.5 border-b border-foreground/10 pb-6">
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
                    Get a wholesale quote
                  </p>
                  <p className="text-sm text-foreground/60">
                    Fields marked required take a minute to fill in.
                  </p>
                </div>
                <DistributionEnquiryForm />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="site-container pt-10 pb-6 md:pt-14 md:pb-8 space-y-5">
        <p className="text-[11px] uppercase tracking-[0.35em] font-bold text-primary">
          Wholesale tile supply, direct from India
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <p className="text-foreground/80 leading-relaxed text-lg">
            LINX Square Distribution supplies high-quality tiles manufactured
            in India directly to UK businesses, developers, retailers,
            merchants and trade customers.
          </p>
          <p className="text-foreground/80 leading-relaxed text-lg">
            Our direct-to-trade model allows us to offer competitive
            wholesale pricing, a wide choice of designs and reliable bulk
            supply for projects and resale.
          </p>
        </div>
      </div>

      <div className="site-container py-16 md:py-20 space-y-14">
        {/* Wholesale Orders | Tile Collections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          <Panel>
            <SectionHeading>Wholesale Orders</SectionHeading>
            <div className="grid grid-cols-2 gap-4 pl-8">
              {WHOLESALE_STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="border border-foreground/10 bg-secondary/20 p-5 space-y-2"
                >
                  <stat.icon className="w-5 h-5 text-primary" strokeWidth={1.6} />
                  <p className="text-xl font-serif tracking-tight text-foreground">
                    {stat.value}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-foreground/50">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-3 pl-8 pt-2">
              <Ship className="w-5 h-5 text-primary shrink-0 mt-0.5" strokeWidth={1.6} />
              <p className="text-sm text-foreground/70 leading-relaxed">
                <span className="font-bold text-foreground/85">
                  Freight &amp; delivery
                </span>{" "}
                — quoted separately based on order quantity and destination.
              </p>
            </div>
          </Panel>

          <Panel>
            <SectionHeading>Explore Our Tile Collections</SectionHeading>
            <p className="text-muted-foreground leading-relaxed pl-8">
              View our latest brochures and discover our range of:
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 pl-8">
              {COLLECTIONS.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 items-baseline text-foreground/80"
                >
                  <span className="text-primary text-[11px] font-bold tracking-[0.2em]">
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground leading-relaxed pl-8">
              Multiple sizes, finishes, colours and designs are available
              across our collections.
            </p>
          </Panel>
        </div>

        {/* Trade & Bulk Supply | Brochures */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          <Panel>
            <SectionHeading>Trade &amp; Bulk Supply</SectionHeading>
            <p className="text-muted-foreground leading-relaxed pl-8">
              We work with:
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 pl-8">
              {TRADE_CUSTOMERS.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 items-baseline text-foreground/80"
                >
                  <span className="text-primary text-[11px] font-bold tracking-[0.2em]">
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <SectionHeading>Brochures</SectionHeading>
            <p className="text-muted-foreground leading-relaxed pl-8">
              Brochures for our current range are coming soon. In the
              meantime, use the enquiry form above and our distribution team
              will send you wholesale pricing and availability directly.
            </p>
          </Panel>
        </div>

        <p className="text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {storeName} — Manufactured in India | Distributed in the UK
        </p>
      </div>

      <Footer initialStoreName={storeName} />
    </main>
  );
}

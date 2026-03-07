import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import Image from "next/image";
import { getStoreName } from "@/app/actions/settings";
import Link from "next/link";

const HERO_IMAGE = "/images/tiles1.jpg";

export default async function CustomDesignPage() {
  const storeName = await getStoreName();

  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title="Custom Design"
        description="Bespoke architectural solutions tailored to your unique requirements."
        breadcrumb={[{ label: "Custom", href: "/custom" }]}
      />

      <section className="py-24 px-6 lg:px-20 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32">
          <div className="space-y-10">
            <p className="uppercase tracking-[0.4em] text-[10px] font-bold opacity-80">
              The Studio Service
            </p>
            <h2 className="text-4xl md:text-5xl font-serif tracking-tight uppercase leading-tight">
              Crafting Your <br />
              <span className="italic lowercase">Individual</span> Vision
            </h2>
            <p className="text-muted-foreground leading-relaxed text-lg max-w-lg">
              {storeName.toUpperCase()} offers an exclusive custom design
              service for discerning clients who require more than standard
              specifications. From unique stone bath configurations to
              custom-cut marble mosaics, our s bring your specific visions to
              life.
            </p>
            <div className="space-y-6 pt-6">
              {[
                "Custom Dimensional Slabs",
                "Unique Stone Bath Configurations",
                " Hand-Cut Mosaics",
                "Private Portfolio Curation",
              ].map((service) => (
                <div key={service} className="flex items-center gap-4 group">
                  <div className="w-1.5 h-1.5 bg-foreground rounded-full group-hover:scale-150 transition-transform" />
                  <span className="uppercase tracking-widest text-xs font-bold">
                    {service}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative aspect-square">
            <Image
              src={HERO_IMAGE}
              alt="Custom Studio"
              fill
              className="object-cover grayscale"
            />
          </div>
        </div>

        <div className="bg-foreground text-background p-16 md:p-24 text-center space-y-12">
          <h2 className="text-3xl md:text-5xl font-serif tracking-tight uppercase">
            Begin Your Custom Journey
          </h2>
          <p className="text-background/60 leading-relaxed max-w-2xl mx-auto italic text-lg">
            "Every project starts with a conversation. We invite you to share
            your architectural prerequisites with our design studio
            specialists."
          </p>
          <Link href="/contact">
            <button className="bg-background text-foreground px-12 py-5 uppercase tracking-widest text-[10px] font-bold hover:bg-accent transition-all">
              Schedule a Design Consultation
            </button>
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}

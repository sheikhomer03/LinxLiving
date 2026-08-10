import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { getConfiguratorHubDepartments } from "@/app/actions/configuratorCategories";
import { getStoreName } from "@/app/actions/settings";
import { getDepartmentTrees } from "@/app/actions/departments";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Configurator",
  description:
    "Configure real catalogue products with live pricing. Change size and options to see the price update.",
  alternates: { canonical: "/configurator" },
};

export const dynamic = "force-dynamic";

export default async function ConfiguratorHubPage() {
  const [storeName, { departments }, deptTrees] = await Promise.all([
    getStoreName(),
    getConfiguratorHubDepartments(),
    getDepartmentTrees(),
  ]);

  return (
    <main className="min-h-screen bg-white">
      <Navbar
        initialStoreName={storeName}
        initialDepartments={deptTrees.departments || []}
      />

      <section className="relative page-top pb-14 md:pb-20 px-6 lg:px-12 xl:px-20 border-b border-foreground/8 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.35]"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 10% 0%, rgba(180,140,90,0.18), transparent 55%), linear-gradient(180deg, #f7f5f2 0%, #ffffff 70%)",
          }}
        />
        <div className="relative max-w-[1400px] mx-auto">
          <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-primary mb-4">
            Product configurator
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl tracking-wide max-w-3xl leading-[1.1]">
            Build your specification
          </h1>
          <p className="mt-5 text-base md:text-lg text-muted-foreground max-w-2xl leading-relaxed">
            Choose a department, pick a real catalogue product, change size and
            options, and watch the live price update on {storeName}.
          </p>
        </div>
      </section>

      <section className="px-6 lg:px-12 xl:px-20 py-12 md:py-16">
        <div className="max-w-[1400px] mx-auto">
          {departments.length === 0 ? (
            <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
              No configurator departments with products are available yet.
              Please check back soon or contact us for help.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-6">
              {departments.map((dept: any) => (
                <Link
                  key={dept._id || dept.slug}
                  href={`/configurator/${dept.slug}`}
                  className="group relative flex flex-col min-h-[260px] border border-foreground/10 bg-[#faf9f7] overflow-hidden hover:border-foreground/30 transition-colors"
                >
                  {dept.image ? (
                    <div className="relative h-40 overflow-hidden">
                      <Image
                        src={dept.image}
                        alt=""
                        fill
                        className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                        sizes="(max-width:768px) 100vw, 33vw"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    </div>
                  ) : null}
                  <div className="flex flex-1 flex-col justify-between p-6 md:p-7">
                    <div className="space-y-3">
                      <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-primary">
                        Configure
                      </p>
                      <h2 className="font-serif text-2xl tracking-wide group-hover:text-primary transition-colors">
                        {dept.name}
                      </h2>
                      {dept.description ? (
                        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                          {dept.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-6 flex items-center justify-between gap-3">
                      <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
                        {typeof dept.productCount === "number"
                          ? `${dept.productCount} product${dept.productCount === 1 ? "" : "s"}`
                          : "Open"}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-bold">
                        Open
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}

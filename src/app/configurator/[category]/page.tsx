import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import {
  getConfiguratorDepartmentPage,
  getConfiguratorHubDepartments,
} from "@/app/actions/configuratorCategories";
import { getPublicProducts } from "@/app/actions/products";
import { getStoreName } from "@/app/actions/settings";
import { getDepartmentTrees } from "@/app/actions/departments";
import { resolveConfiguratorImages } from "@/lib/configuratorImages";
import { ArrowRight, Package } from "lucide-react";
import {
  isPriceOnRequest,
  PRICE_ON_REQUEST_LABEL,
} from "@/lib/priceOnRequest";

type Props = {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ menu?: string }>;
};

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  const { departments } = await getConfiguratorHubDepartments();
  return departments.map((d: any) => ({ category: d.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const { department } = await getConfiguratorDepartmentPage(slug);
  if (!department) return { title: "Configurator" };
  return {
    title: `${department.name} | Configurator`,
    description: department.description || department.name,
    alternates: { canonical: `/configurator/${slug}` },
  };
}

function money(n: number) {
  return `£${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function ConfiguratorDepartmentPage({
  params,
  searchParams,
}: Props) {
  const { category: slug } = await params;
  const { menu: menuSlug } = await searchParams;

  const [{ department, menus }, storeName, deptTrees] = await Promise.all([
    getConfiguratorDepartmentPage(slug),
    getStoreName(),
    getDepartmentTrees(),
  ]);
  if (!department) notFound();

  const catalog = await getPublicProducts({
    department: slug,
    category: menuSlug || undefined,
    limit: 48,
    sort: "newest",
    fields:
      "name price images category subCategory stock specs brand department variants",
    departmentStrict: true,
  });
  const realProducts = catalog.products || [];

  return (
    <main className="min-h-screen bg-white">
      <Navbar
        initialStoreName={storeName}
        initialDepartments={deptTrees.departments || []}
      />

      <section className="pt-28 sm:pt-32 md:pt-40 pb-10 px-6 lg:px-12 xl:px-20 border-b border-foreground/8 bg-[#f7f5f2]">
        <div className="max-w-[1400px] mx-auto space-y-4">
          <nav className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <Link href="/configurator" className="hover:text-foreground">
              Configurator
            </Link>
            <span>/</span>
            <span className="text-foreground">{department.name}</span>
          </nav>
          <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-primary">
            Configure · Live catalogue
          </p>
          <h1 className="font-serif text-4xl md:text-5xl tracking-wide">
            {department.name}
          </h1>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            {department.description ||
              `Select a product, change size and options, and see the live price update on ${storeName}.`}
          </p>
          <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-foreground/50">
            {realProducts.length} product
            {realProducts.length === 1 ? "" : "s"}
            {menuSlug ? " in this category" : " in this department"}
          </p>
        </div>
      </section>

      <section className="px-6 lg:px-12 xl:px-20 py-12 md:py-16">
        <div className="max-w-[1400px] mx-auto space-y-14">
          {menus?.length ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-[11px] uppercase tracking-[0.2em] font-bold">
                  Shop by category
                </h2>
                {menuSlug ? (
                  <Link
                    href={`/configurator/${slug}`}
                    className="text-[11px] uppercase tracking-[0.16em] font-bold text-muted-foreground hover:text-foreground"
                  >
                    Clear filter
                  </Link>
                ) : null}
              </div>
              <ul className="flex flex-wrap gap-2">
                {menus.map((menu: any) => {
                  const active = menuSlug === menu.slug;
                  return (
                    <li key={menu._id}>
                      <Link
                        href={
                          active
                            ? `/configurator/${slug}`
                            : `/configurator/${slug}?menu=${encodeURIComponent(menu.slug)}`
                        }
                        className={`inline-flex items-center px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] font-bold border transition-colors ${
                          active
                            ? "bg-foreground text-background border-foreground"
                            : "border-foreground/15 hover:border-foreground/40"
                        }`}
                      >
                        {menu.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="space-y-5">
            <h2 className="text-[11px] uppercase tracking-[0.2em] font-bold">
              Products
            </h2>
            {!realProducts.length ? (
              <div className="border border-dashed border-foreground/15 p-10 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  No catalogue products found for this selection yet.
                </p>
                <Link
                  href={`/category?department=${encodeURIComponent(slug)}`}
                  className="inline-flex text-[11px] uppercase tracking-[0.16em] font-bold hover:text-primary"
                >
                  Browse full catalogue →
                </Link>
              </div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-6">
                {realProducts.map((product: any) => {
                  const img = resolveConfiguratorImages(product)[0] || "";
                  const size =
                    product.specs?.size ||
                    product.specs?.Size ||
                    product.specs?.SIZE;
                  return (
                    <li key={String(product._id)}>
                      <Link
                        href={`/configurator/item/${product._id}`}
                        className="group flex flex-col h-full border border-foreground/10 bg-white hover:border-foreground/30 transition-colors"
                      >
                        <div className="relative aspect-[4/3] bg-secondary overflow-hidden flex items-center justify-center">
                          {img ? (
                            <Image
                              src={img}
                              alt={product.name}
                              fill
                              className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                              sizes="(max-width:768px) 100vw, 33vw"
                            />
                          ) : (
                            <Package className="w-10 h-10 text-foreground/20" />
                          )}
                          <span className="absolute left-3 bottom-3 text-[9px] uppercase tracking-[0.16em] font-bold bg-white/95 px-2.5 py-1">
                            Configure
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col p-5 space-y-3">
                          <h3 className="font-serif text-lg tracking-wide leading-snug group-hover:text-primary transition-colors line-clamp-2">
                            {product.name}
                          </h3>
                          {size ? (
                            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                              Size {String(size)}
                            </p>
                          ) : null}
                          <div className="mt-auto flex items-end justify-between gap-3 pt-2">
                            <p className="text-base font-semibold tabular-nums">
                              {isPriceOnRequest(product.price)
                                ? PRICE_ON_REQUEST_LABEL
                                : money(Number(product.price) || 0)}
                            </p>
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/60 group-hover:text-foreground">
                              Configure
                              <ArrowRight className="w-3.5 h-3.5" />
                            </span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Link
            href="/configurator"
            className="inline-block text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground hover:text-foreground"
          >
            ← All departments
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { RealProductConfigurator } from "@/components/configurator/RealProductConfigurator";
import { getPublicProduct, getPublicProducts } from "@/app/actions/products";
import { getStoreName } from "@/app/actions/settings";
import { getDepartmentTrees } from "@/app/actions/departments";
import { resolveConfiguratorImages } from "@/lib/configuratorImages";
import { parseProductExtras } from "@/lib/productExtras";
import { Brand } from "@/models/Brand";
import connectDB from "@/lib/mongodb";
import { Department } from "@/models/Department";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

function pickSpec(specs: Record<string, unknown> | undefined, key: string) {
  if (!specs) return undefined;
  const direct = specs[key];
  if (direct != null && String(direct).trim()) return String(direct);
  const lower = Object.entries(specs).find(
    ([k]) => k.toLowerCase() === key.toLowerCase(),
  );
  if (lower?.[1] != null && String(lower[1]).trim()) return String(lower[1]);
  return undefined;
}

/** Fallback when size lives in the product name (e.g. "Quartz White 60x90"). */
function sizeFromName(name: string) {
  const m = String(name || "").match(
    /(\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?)/i,
  );
  return m ? m[1].replace(/\s+/g, "").replace(/,/g, ".") : undefined;
}

function resolveProductSize(
  specs: Record<string, unknown> | undefined,
  name: string,
) {
  return pickSpec(specs, "size") || sizeFromName(name);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const product = await getPublicProduct(id);
  if (!product) return { title: "Configurator" };
  return {
    title: `Configure ${product.name}`,
    description: `Configure ${product.name} with live pricing.`,
    alternates: { canonical: `/configurator/item/${id}` },
  };
}

export default async function ConfiguratorItemPage({ params }: Props) {
  const { id } = await params;
  const [product, storeName, deptRes] = await Promise.all([
    getPublicProduct(id),
    getStoreName(),
    getDepartmentTrees(),
  ]);
  if (!product) notFound();

  const extras = parseProductExtras({
    installationGuide: product.installationGuide,
    insulatingSetPrice: product.insulatingSetPrice,
    flashingFinder: product.flashingFinder,
    finishes: product.finishes,
    flashings: product.flashings,
  });

  const specs = (product.specs || {}) as Record<string, unknown>;
  const size = resolveProductSize(specs, product.name);

  let brandName: string | undefined;
  if (product.brand) {
    try {
      await connectDB();
      const brand = await Brand.findById(product.brand).select("name").lean();
      brandName = brand?.name;
    } catch {
      /* ignore */
    }
  }

  /** Strip trailing size tokens so "Quartz White 60x90" groups with "Quartz White 70x100". */
  const familyKey = (name: string) =>
    String(name || "")
      .toLowerCase()
      .replace(/[\d]+(\s*[x×]\s*[\d]+)+/gi, " ")
      .replace(/\b\d+\s*mm\b/gi, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");

  const currentFamily = familyKey(product.name);
  const images = resolveConfiguratorImages(product);

  // Sibling sizes: same category (+ brand) and same name family
  const siblings = await getPublicProducts({
    category: product.category,
    brand: undefined,
    limit: 80,
    skipCount: true,
    fields:
      "name price images category specs brand stock shopifyVariantId",
  });
  const sizeOptions = (siblings.products || [])
    .map((p: any) => {
      const s = resolveProductSize(
        (p.specs || {}) as Record<string, unknown>,
        p.name,
      );
      if (!s) return null;
      if (product.brand && p.brand && String(p.brand) !== String(product.brand)) {
        return null;
      }
      if (currentFamily && familyKey(p.name) !== currentFamily) {
        return null;
      }
      const siblingImages = resolveConfiguratorImages(p);
      return {
        id: String(p._id),
        size: s,
        price: Number(p.price) || 0,
        name: String(p.name || ""),
        stock: Number(p.stock) || 0,
        shopifyVariantId: p.shopifyVariantId || null,
        image: siblingImages[0] || "",
      };
    })
    .filter(Boolean) as {
    id: string;
    size: string;
    price: number;
    name: string;
    stock: number;
    shopifyVariantId: string | null;
    image: string;
  }[];

  // Dedupe by size, keep current product first
  const seen = new Set<string>();
  const uniqueSizes: typeof sizeOptions = [];
  for (const opt of [
    ...(size
      ? [
          {
            id: String(product._id),
            size,
            price: Number(product.price) || 0,
            name: String(product.name || ""),
            stock: Number(product.stock) || 0,
            shopifyVariantId: product.shopifyVariantId || null,
            image: images[0] || "",
          },
        ]
      : []),
    ...sizeOptions,
  ]) {
    const key = opt.size.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSizes.push(opt);
  }
  uniqueSizes.sort((a, b) =>
    a.size.localeCompare(b.size, undefined, { numeric: true }),
  );

  const deptSlug = String(product.department || "").trim();
  let departmentName: string | undefined;
  let departmentSlug: string | undefined = deptSlug || undefined;
  if (deptSlug) {
    try {
      await connectDB();
      const d = await Department.findOne({ slug: deptSlug })
        .select("name slug")
        .lean();
      if (d) {
        departmentName = d.name;
        departmentSlug = d.slug;
      }
    } catch {
      /* ignore */
    }
  }
  if (!departmentName && deptRes.departments?.length) {
    const match = deptRes.departments.find(
      (d: any) =>
        d.slug === deptSlug ||
        (d.categories || []).some(
          (c: any) =>
            c.slug === product.category ||
            c.name === product.category ||
            (c.children || []).some(
              (ch: any) =>
                ch.slug === product.subCategory ||
                ch.name === product.subCategory,
            ),
        ),
    );
    if (match) {
      departmentName = match.name;
      departmentSlug = match.slug;
    }
  }

  const variants = (product.variants || [])
    .map((v: any) => ({
      id: String(v._id || v.name),
      name: String(v.name || "").trim(),
      price:
        v.price != null && Number.isFinite(Number(v.price))
          ? Number(v.price)
          : null,
      stock: typeof v.stock === "number" ? v.stock : null,
      imageUrl: String(v.imageUrl || "").trim() || undefined,
    }))
    .filter((v: any) => v.name);

  return (
    <main className="min-h-screen bg-[#fafafa]">
      <Navbar
        initialDepartments={deptRes.departments || []}
        initialStoreName={storeName}
      />

      <div className="page-top pb-6 px-6 lg:px-12 xl:px-20 border-b border-foreground/8 bg-white">
        <div className="max-w-8xl mx-auto">
          <nav className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-4">
            <Link href="/configurator" className="hover:text-foreground">
              Configurator
            </Link>
            {departmentSlug ? (
              <>
                <span>/</span>
                <Link
                  href={`/configurator/${departmentSlug}`}
                  className="hover:text-foreground"
                >
                  {departmentName || departmentSlug}
                </Link>
              </>
            ) : null}
            <span>/</span>
            <span className="text-foreground line-clamp-1">{product.name}</span>
          </nav>
          <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-primary">
            Configure · Live price
          </p>
        </div>
      </div>

      <section className="px-6 lg:px-12 xl:px-20 py-10 md:py-14">
        <div className="max-w-8xl mx-auto">
          <RealProductConfigurator
            product={{
              id: String(product._id),
              name: product.name,
              price: Number(product.price) || 0,
              images,
              category: product.category,
              stock: Number(product.stock) || 0,
              shopifyVariantId: product.shopifyVariantId,
              size,
              brandName,
              insulatingSetPrice: extras.insulatingSetPrice,
              finishes: extras.finishes || [],
              flashings: extras.flashings || [],
              description: product.description,
              sizeOptions: uniqueSizes.length > 1 ? uniqueSizes : undefined,
              variants,
            }}
            departmentSlug={departmentSlug}
            departmentName={departmentName}
          />

          <div className="mt-10">
            <Link
              href={
                departmentSlug
                  ? `/configurator/${departmentSlug}`
                  : "/configurator"
              }
              className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground hover:text-foreground"
            >
              ← Back to {departmentName || "configurator"}
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

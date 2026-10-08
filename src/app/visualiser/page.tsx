import Link from "next/link";
import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { getStoreName } from "@/app/actions/settings";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getPublicProduct, getPublicProductBySlug } from "@/app/actions/products";
import { isObjectIdLike } from "@/lib/productSlug";
import { buildDesignCard, fetchDesignsPage, getBrandIndex } from "@/lib/visualiser/designs";
import { toVisualiserDesign } from "@/lib/visualiser/flooring";
import { toTileDesign } from "@/lib/visualiser/tiles";
import { VisualiserLoader } from "@/components/visualiser/VisualiserLoader";

export const metadata: Metadata = {
  title: "Visualise flooring and tiles in your room",
  description:
    "Upload a photo of your room and see any of our floors and tiles laid on its floor and walls, at real size, before you buy.",
  alternates: { canonical: "/visualiser" },
  // A tool page with a per-product query string; nothing for search to index.
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

/** A product slug as stored (lib/productSlug): lowercase words joined by "-". */
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async function VisualiserPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.product) ? sp.product[0] : sp.product)?.trim();

  // ?product= is the product's slug. A database id is still accepted, for
  // links made before slugs — the visualiser then shows the slug in the
  // address once the design loads (VisualiserApp).
  const requestedProduct = !raw
    ? Promise.resolve(null)
    : isObjectIdLike(raw)
      ? getPublicProduct(raw)
      : raw.length <= 200 && SLUG_SHAPE.test(raw)
        ? getPublicProductBySlug(raw)
        : Promise.resolve(null);
  const [storeName, deptTrees, brands, firstPage, requested] = await Promise.all([
    getStoreName(),
    getDepartmentTrees(),
    getBrandIndex(),
    // The list opens on what the customer came from: tiles for a tile, and
    // flooring otherwise (buildDesignCard decides flooring first, the same way).
    requestedProduct.then((product) =>
      fetchDesignsPage({
        surface: "floor",
        page: 1,
        q: "",
        type: product && !toVisualiserDesign(product) && toTileDesign(product) ? "all-tiles" : "all-flooring",
        sort: "",
      }),
    ),
    requestedProduct,
  ]);

  const requestedDesign = requested ? buildDesignCard(requested, brands) : null;
  // Asked for a product the visualiser can't lay (not flooring or a tile, a
  // mat or an accessory, no photo, or gone): say so, and start from the
  // first design instead.
  const notAvailable = Boolean(raw) && !requestedDesign;
  const initialDesign = requestedDesign ?? firstPage.designs[0] ?? null;

  return (
    <main className="min-h-screen bg-white">
      <Navbar initialStoreName={storeName} initialDepartments={deptTrees.departments || []} />

      {/* The visualiser fills the screen under the site header, as an app. */}
      <section className="page-top">
        <h1 className="sr-only">Visualise flooring and tiles in your room</h1>

        {notAvailable ? (
          <div role="status" className="border-t border-black/10 bg-[#f7f7f7] px-4 py-2 text-center text-xs text-black/80">
            That product can&apos;t be shown in the room visualiser — it works for flooring and tiles. Choose any design to get started.
          </div>
        ) : null}

        {initialDesign ? (
          <VisualiserLoader initialDesign={initialDesign} initialDesigns={firstPage} />
        ) : (
          <div className="mx-4 my-10 rounded-md bg-[#f7f7f7] px-6 py-16 text-center text-sm text-black/70">
            The room visualiser isn&apos;t available right now. Please{" "}
            <Link href="/category?department=flooring" className="underline">
              browse our flooring
            </Link>{" "}
            instead.
          </div>
        )}
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { getStoreName } from "@/app/actions/settings";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getPublicProduct } from "@/app/actions/products";
import { buildDesignCard, fetchDesignsPage, getBrandIndex } from "@/lib/visualiser/designs";
import { VisualiserLoader } from "@/components/visualiser/VisualiserLoader";

export const metadata: Metadata = {
  title: "Visualise flooring in your room",
  description:
    "Upload a photo of your room and see any of our floors laid in it, at real size, before you buy.",
  alternates: { canonical: "/visualiser" },
  // A tool page with a per-product query string; nothing for search to index.
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export default async function VisualiserPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.product) ? sp.product[0] : sp.product;
  const requestedId = raw && OBJECT_ID.test(raw) ? raw : null;

  const [storeName, deptTrees, brands, firstPage, requested] = await Promise.all([
    getStoreName(),
    getDepartmentTrees(),
    getBrandIndex(),
    fetchDesignsPage({ page: 1, q: "", type: "all", sort: "" }),
    requestedId ? getPublicProduct(requestedId) : Promise.resolve(null),
  ]);

  const requestedDesign = requested ? buildDesignCard(requested, brands) : null;
  // Asked for a product the visualiser can't lay (not flooring, a mat, no
  // photo, or gone): say so, and start from the first floor instead.
  const notAvailable = Boolean(raw) && !requestedDesign;
  const initialDesign = requestedDesign ?? firstPage.designs[0] ?? null;

  return (
    <main className="min-h-screen bg-white">
      <Navbar initialStoreName={storeName} initialDepartments={deptTrees.departments || []} />

      {/* The visualiser fills the screen under the site header, as an app. */}
      <section className="page-top">
        <h1 className="sr-only">Visualise flooring in your room</h1>

        {notAvailable ? (
          <div role="status" className="border-t border-black/10 bg-[#f7f7f7] px-4 py-2 text-center text-xs text-black/80">
            That product can&apos;t be shown in the room visualiser — it currently works for flooring. Choose any floor to get started.
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

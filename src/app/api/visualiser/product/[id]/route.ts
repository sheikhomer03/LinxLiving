/* eslint-disable @typescript-eslint/no-explicit-any -- lean Mongo documents, as in actions/products.ts */
import { NextResponse } from "next/server";
import { getPublicProduct, getPublicProductBySlug } from "@/app/actions/products";
import { getBrandIndex } from "@/lib/visualiser/designs";
import { buildCalculatorProduct } from "@/lib/visualiser/calculatorProduct";
import { isVisualisableFlooring } from "@/lib/visualiser/flooring";
import { isVisualisableTile } from "@/lib/visualiser/tiles";

/**
 * GET /api/visualiser/product/:id
 *
 * The pricing data the visualiser's quantity calculator needs for one
 * product — the same fields, derived the same way, as the product page hands
 * its calculators. Only for products the visualiser can lay (flooring or
 * tiles); nothing private.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OBJECT_ID = /^[a-f0-9]{24}$/i;
/** A product slug as stored (lib/productSlug). */
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // The product's slug (what the visualiser sends); an id still answers.
  const { id: ref } = await params;
  const byId = OBJECT_ID.test(ref || "");
  if (!byId && !(ref && ref.length <= 200 && SLUG_SHAPE.test(ref))) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  try {
    const [product, brands] = await Promise.all([
      byId ? getPublicProduct(ref) : getPublicProductBySlug(ref),
      getBrandIndex(),
    ]);
    if (!product || !(isVisualisableFlooring(product as any) || isVisualisableTile(product as any))) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    const brandId = (product as any).brand
      ? String(
          typeof (product as any).brand === "object"
            ? (product as any).brand._id || (product as any).brand
            : (product as any).brand,
        )
      : "";
    const brand = brands.get(brandId);
    const body = buildCalculatorProduct(product, brand ? { name: brand.rawName, slug: brand.slug } : null);
    return NextResponse.json(
      { product: body },
      // Price and stock: the same short CDN window as the catalogue (and the
      // product itself is cached 30 s server-side, as on its own page).
      { headers: { "Vercel-CDN-Cache-Control": "max-age=15, stale-while-revalidate=15" } },
    );
  } catch (error) {
    console.error("[visualiser/product]", error);
    return NextResponse.json({ error: "Could not load this product. Please try again." }, { status: 500 });
  }
}

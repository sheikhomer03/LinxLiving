import connectDB from "@/lib/mongodb";
import { attachBrands, fedFind } from "@/lib/mongoCluster";
import {
  freeSampleInputFromProduct,
  hasFreeSample,
} from "@/lib/freeSample";

export type FreeSampleProduct = {
  id: string;
  /** Storefront slug — how the order names the product to the shopper. */
  slug: string;
  name: string;
  sku: string;
  /**
   * The product's own Shopify variant. The checkout's sample line names it
   * (at £0) so Shopify shows the product's photo — a line with no variant
   * gets Shopify's grey placeholder, and a custom line cannot carry an image.
   */
  shopifyVariantId: string | null;
};

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** The most products one basket can ask about — far beyond any real cart. */
const MAX_PRODUCTS = 200;

/**
 * Of these products, the ones that come with a free sample — read from Mongo,
 * so the answer never rests on anything the browser sent.
 *
 * Used by the cart (through getFreeSampleProductIds) to show the sample lines,
 * and by both checkouts to put the same £0 lines on the order. Same rule,
 * same data: what the shopper saw is what the order gets.
 */
export async function freeSampleProducts(
  productIds: readonly string[],
): Promise<FreeSampleProduct[]> {
  const ids = [
    ...new Set(
      (Array.isArray(productIds) ? productIds : [])
        .map((id) => String(id || ""))
        .filter((id) => OBJECT_ID.test(id)),
    ),
  ].slice(0, MAX_PRODUCTS);
  if (!ids.length) return [];

  await connectDB();
  type Row = {
    _id: unknown;
    slug?: unknown;
    name?: string;
    price?: unknown;
    department?: unknown;
    category?: unknown;
    subCategory?: unknown;
    specs?: unknown;
    soldPerUnit?: unknown;
    pergolaSizeRows?: unknown;
    brand?: unknown;
    linxSku?: unknown;
    supplierSku?: unknown;
    productCode?: unknown;
    shopifyVariantId?: unknown;
  };
  const rows = await fedFind<Row>(
    (M) =>
      M.find({ _id: { $in: ids } })
        .select(
          "slug name price department category subCategory specs soldPerUnit pergolaSizeRows brand linxSku supplierSku productCode shopifyVariantId",
        )
        .lean() as Promise<Row[]>,
  );
  await attachBrands(rows, "name slug");

  const out: FreeSampleProduct[] = [];
  for (const row of rows) {
    const brand =
      row.brand && typeof row.brand === "object"
        ? (row.brand as { name?: string; slug?: string })
        : null;
    if (!hasFreeSample(freeSampleInputFromProduct(row, brand))) continue;
    out.push({
      id: String(row._id),
      slug: String(row.slug || ""),
      name: String(row.name || ""),
      sku: String(row.linxSku || row.supplierSku || row.productCode || ""),
      shopifyVariantId: String(row.shopifyVariantId || "").startsWith(
        "gid://shopify/ProductVariant/",
      )
        ? String(row.shopifyVariantId)
        : null,
    });
  }
  // The basket's order, not the database's.
  return ids
    .map((id) => out.find((p) => p.id === id))
    .filter((p): p is FreeSampleProduct => Boolean(p));
}

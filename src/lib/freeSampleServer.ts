import connectDB from "@/lib/mongodb";
import { attachBrands, fedFind } from "@/lib/mongoCluster";
import {
  freeSampleInputFromProduct,
  hasFreeSample,
} from "@/lib/freeSample";

export type FreeSampleProduct = { id: string; name: string; sku: string };

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
  };
  const rows = await fedFind<Row>(
    (M) =>
      M.find({ _id: { $in: ids } })
        .select(
          "name price department category subCategory specs soldPerUnit pergolaSizeRows brand linxSku supplierSku productCode",
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
      name: String(row.name || ""),
      sku: String(row.linxSku || row.supplierSku || row.productCode || ""),
    });
  }
  // The basket's order, not the database's.
  return ids
    .map((id) => out.find((p) => p.id === id))
    .filter((p): p is FreeSampleProduct => Boolean(p));
}

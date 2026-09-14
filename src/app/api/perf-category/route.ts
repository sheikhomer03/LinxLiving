/* TEMPORARY diagnostic route — delete when the category investigation is done. */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { getPublicProducts } from "@/app/actions/products";
import { buildListingQuery } from "@/lib/listingQuery";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dept = url.searchParams.get("department") || "flooring";
  const ms: Record<string, number> = {};
  const info: Record<string, unknown> = {};

  const time = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = performance.now();
    const out = await fn();
    ms[name] = Math.round(performance.now() - t);
    return out;
  };

  await time("connectDB", () => connectDB());
  await time("ping (one round trip)", async () => {
    await Product.db.db!.command({ ping: 1 });
  });

  const { query } = buildListingQuery({
    searchKey: `department=${dept}`,
    slug: "all",
    browseAll: true,
  });
  const q = query as Record<string, unknown>;

  const full = await time("Featured (what the page runs)", () =>
    getPublicProducts(q as never),
  );
  info.total = (full as { total?: number })?.total ?? null;
  info.returned = (full as { products?: unknown[] })?.products?.length ?? 0;

  await time("explicit sort (skips Featured)", () =>
    getPublicProducts({ ...q, sort: "price-asc" } as never),
  );
  await time("Featured + skipCount", () =>
    getPublicProducts({ ...q, skipCount: true } as never),
  );
  await time("Featured, no requireImages", () =>
    getPublicProducts({ ...q, requireImages: false } as never),
  );
  await time("Featured, two fields only", () =>
    getPublicProducts({ ...q, fields: "name price" } as never),
  );

  const prods = ((full as { products?: any[] })?.products || []) as any[];
  info.needsEnrichOnPage = prods.filter(
    (p) =>
      p?.shopifyProductId &&
      (!(Number(p.price) > 0) || !(Number(p.stock) > 0)),
  ).length;
  info.pageBytes = JSON.stringify(prods).length;

  return NextResponse.json(
    { dept, ms, info },
    { headers: { "Cache-Control": "no-store" } },
  );
}

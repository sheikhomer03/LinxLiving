/* TEMPORARY diagnostic route — delete when the category investigation is done. */
import { NextResponse } from "next/server";
import { getPublicProducts } from "@/app/actions/products";
import { buildListingQuery } from "@/lib/listingQuery";

/**
 * The exact order a listing renders, page by page, as ids.
 *
 * Used to prove the Featured rewrite returns the same products in the same
 * order as the version it replaced: capture with one implementation, capture
 * with the other, diff.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const depts = (url.searchParams.get("departments") || "tiles,flooring,bathrooms,heating,accessories,electrical").split(",");
  const pages = Number(url.searchParams.get("pages") || 4);

  const out: Record<string, unknown> = {};

  for (const dept of depts) {
    const perDept: Record<string, unknown> = {};
    for (let page = 1; page <= pages; page++) {
      const { query } = buildListingQuery({
        searchKey: `department=${dept}&page=${page}`,
        slug: "all",
        browseAll: true,
      });
      const res = await getPublicProducts(query as Parameters<typeof getPublicProducts>[0]);
      perDept[`page${page}`] = {
        total: res.total,
        ids: (res.products as any[]).map((p) => String(p._id)),
      };
    }
    out[dept] = perDept;
  }

  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}

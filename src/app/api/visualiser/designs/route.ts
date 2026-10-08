import { NextResponse } from "next/server";
import { parseDesignsQuery } from "@/lib/visualiser/designsQuery";
import { fetchDesignsPage } from "@/lib/visualiser/designs";

/**
 * GET /api/visualiser/designs?surface=floor|wall&page=&q=&type=&sort=[&ids=]
 *
 * The designs the room visualiser can lay on one surface, a page at a time,
 * under the same storefront rules as the Flooring and Tiles departments
 * (priced, photographed, hidden brands left out), minus mats, rugs, fittings
 * and tile accessories. `type` is all-flooring or all-tiles — one kind per
 * list, never mixed; a wall lists tiles only. Query values are validated and
 * clamped by parseDesignsQuery.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseDesignsQuery(new URL(request.url).searchParams);
  try {
    const body = await fetchDesignsPage(query);
    return NextResponse.json(body, {
      // The same CDN rule as the catalogue pages (next.config.ts): Vercel may
      // keep each URL — query string included — for 15 s and serve it for 15
      // more while it refreshes. Nothing here is personal. Server-side the
      // listing is cached for 30 s as well (see lib/visualiser/designs).
      headers: { "Vercel-CDN-Cache-Control": "max-age=15, stale-while-revalidate=15" },
    });
  } catch (error) {
    console.error("[visualiser/designs]", error);
    return NextResponse.json(
      { error: "Could not load designs. Please try again." },
      { status: 500 },
    );
  }
}

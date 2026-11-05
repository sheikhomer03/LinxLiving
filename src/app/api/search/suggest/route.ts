import { NextResponse } from "next/server";
import { getPublicProducts } from "@/app/actions/products";
import { LISTING_FIELDS } from "@/lib/listingQuery";

/**
 * GET /api/search/suggest?q=&limit=
 *
 * The search box's results as they are typed. A GET rather than a server
 * action: actions cannot be cached, and Next runs a page's actions one at a
 * time, so each keystroke queued behind the last.
 *
 * Fixed query apart from the term and a small limit. An empty result is not
 * kept at the CDN, because a failed read also comes back empty.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TERM_LENGTH = 120;
const MAX_LIMIT = 6;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const term = String(params.get("q") || "").trim().slice(0, MAX_TERM_LENGTH);
  const limit = Math.min(Math.max(Number(params.get("limit")) || MAX_LIMIT, 1), MAX_LIMIT);

  if (term.length <= 1) return NextResponse.json({ products: [] });

  const { products } = await getPublicProducts({
    search: term,
    limit,
    fields: LISTING_FIELDS,
    imageSlice: 2,
    skipCount: true,
  });

  return NextResponse.json(
    { products },
    products.length
      ? {
          headers: {
            "Vercel-CDN-Cache-Control": "max-age=30, stale-while-revalidate=30",
          },
        }
      : undefined,
  );
}

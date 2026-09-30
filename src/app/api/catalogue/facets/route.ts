import { NextResponse } from "next/server";
import { getCatalogFacetCountsWithAge } from "@/app/actions/products";

/** Matches `revalidate` on the server's facet-count cache. */
const FACET_TTL_SECONDS = 120;

/**
 * Catalogue facet counts over plain GET.
 *
 * The catalogue used to read these through a server action. Actions are POSTs
 * the browser cannot cache, so every department click downloaded the same
 * ~114 KB again, and Next runs a page's actions one at a time, so the counts
 * also held up the review stars and "Load More" behind them.
 *
 * Same function, same cached counts. The browser may reuse the response only
 * for what is left of the server entry's two minutes, so a count shown is
 * never older than the action could already have returned.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const { counts, computedAt } = await getCatalogFacetCountsWithAge({
    brand: url.searchParams.get("brand") || undefined,
    subBrand: url.searchParams.get("subBrand") || undefined,
  });

  const ageSeconds =
    computedAt == null ? FACET_TTL_SECONDS : (Date.now() - computedAt) / 1000;
  const remaining = Math.max(0, Math.floor(FACET_TTL_SECONDS - ageSeconds));

  return NextResponse.json(counts, {
    headers: {
      "Cache-Control": remaining > 0 ? `private, max-age=${remaining}` : "no-store",
    },
  });
}

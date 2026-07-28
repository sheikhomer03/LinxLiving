import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isShopifyConfigured } from "@/lib/shopify";
import { pullAllFromShopify } from "@/lib/shopify/pull-all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Silent two-way sync used by the admin auto-sync poller:
 * Shopify → Mongo (pull) + push unsynced Brands/Collections/Coupons.
 * POST /api/admin/shopify/auto-sync
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isShopifyConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Shopify not configured" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit) || 25, 50);

  try {
    const results = await pullAllFromShopify(limit);
    const summary = Object.fromEntries(
      Object.entries(results).map(([key, val]) => [
        key,
        {
          ok: Boolean(val.ok),
          pulled: val.pulled ?? 0,
          error: val.error,
        },
      ]),
    );

    return NextResponse.json({
      ok: true,
      at: Date.now(),
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Auto sync failed",
      },
      { status: 500 },
    );
  }
}

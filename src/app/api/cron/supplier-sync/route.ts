import { NextResponse } from "next/server";
import { syncAllSupplierCatalogs } from "@/lib/suppliers/syncEngine";

/**
 * Scheduled stock/price sync.
 * Call with header: Authorization: Bearer $CRON_SECRET
 * Or ?secret=$CRON_SECRET
 *
 * Example (Vercel cron / external scheduler):
 *   GET /api/cron/supplier-sync
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  const secret =
    process.env.CRON_SECRET || process.env.SUPPLIER_SYNC_SECRET || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const querySecret = url.searchParams.get("secret") || "";

  if (!secret || (bearer !== secret && querySecret !== secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applyMargin = url.searchParams.get("applyMargin") !== "false";
  const result = await syncAllSupplierCatalogs({ applyMargin });
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return GET(req);
}

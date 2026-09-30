import { NextResponse } from "next/server";
import { getApprovedReviewSummaries } from "@/app/actions/reviews";

/**
 * Review averages for catalogue cards, over plain GET.
 *
 * Same function the catalogue called as a server action. As an action it
 * queued behind the page's other actions (Next runs them one at a time); as
 * a GET it loads alongside them. Not cached — it answers live, as before.
 */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const summaries = await getApprovedReviewSummaries(ids);
  return NextResponse.json(summaries, {
    headers: { "Cache-Control": "no-store" },
  });
}

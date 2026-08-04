import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/** Bust getBrandMenuTrees / navbar cache after taxonomy imports. */
export async function POST() {
  // Next.js 16 requires a cacheLife profile; expire:0 for immediate bust.
  revalidateTag("navigation", { expire: 0 });
  return NextResponse.json({ ok: true, tag: "navigation" });
}

export async function GET() {
  revalidateTag("navigation", { expire: 0 });
  return NextResponse.json({ ok: true, tag: "navigation" });
}

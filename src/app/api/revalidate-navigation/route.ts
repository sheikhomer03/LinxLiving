import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/** Bust getBrandMenuTrees / navbar cache after taxonomy imports. */
export async function POST() {
  revalidateTag("navigation");
  return NextResponse.json({ ok: true, tag: "navigation" });
}

export async function GET() {
  revalidateTag("navigation");
  return NextResponse.json({ ok: true, tag: "navigation" });
}

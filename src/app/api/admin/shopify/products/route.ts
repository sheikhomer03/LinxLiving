import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  fetchStorefrontProducts,
  isShopifyStorefrontEnabled,
} from "@/lib/shopify";

/**
 * Admin-only smoke test for Storefront API.
 * GET /api/admin/shopify/products?first=5
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isShopifyStorefrontEnabled()) {
    return NextResponse.json(
      {
        error:
          "Storefront not enabled. Set SHOPIFY_STOREFRONT_ACCESS_TOKEN and SHOPIFY_STOREFRONT_ENABLED=true",
      },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const first = Math.min(
    parseInt(searchParams.get("first") || "5", 10) || 5,
    25,
  );

  try {
    const products = await fetchStorefrontProducts({ first });
    return NextResponse.json({ success: true, count: products.length, products });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Fetch failed",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getShopifyConfig,
  isShopifyConfigured,
  isShopifyCheckoutEnabled,
  isShopifyStorefrontEnabled,
  isShopifySyncEnabled,
  shopifyAdminHealthcheck,
} from "@/lib/shopify";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getShopifyConfig();
  const configured = isShopifyConfigured();

  if (!configured || !config) {
    return NextResponse.json({
      configured: false,
      syncEnabled: false,
      storefrontEnabled: false,
      checkoutEnabled: false,
      health: {
        ok: false,
        error:
          "Missing SHOPIFY_STORE_DOMAIN and credentials. Set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard) or legacy SHOPIFY_ADMIN_ACCESS_TOKEN.",
      },
    });
  }

  const health = await shopifyAdminHealthcheck();

  return NextResponse.json({
    configured: true,
    syncEnabled: isShopifySyncEnabled(),
    storefrontEnabled: isShopifyStorefrontEnabled(),
    checkoutEnabled: isShopifyCheckoutEnabled(),
    storeDomain: config.storeDomain,
    apiVersion: config.apiVersion,
    authMode:
      config.clientId && config.clientSecret
        ? "client_credentials"
        : "static_token",
    hasStorefrontToken: Boolean(config.storefrontAccessToken),
    health,
  });
}

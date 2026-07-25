import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isShopifyConfigured, shopifyAdminRequest } from "@/lib/shopify";

/**
 * Create a shop Storefront access token via Admin API (one-time setup helper).
 * Copy the returned token into SHOPIFY_STOREFRONT_ACCESS_TOKEN.
 *
 * POST /api/admin/shopify/storefront-token
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isShopifyConfigured()) {
    return NextResponse.json(
      { error: "Shopify is not configured" },
      { status: 400 },
    );
  }

  try {
    const data = await shopifyAdminRequest<{
      storefrontAccessTokenCreate: {
        storefrontAccessToken: {
          accessToken: string;
          title: string;
          accessScopes: { handle: string }[];
        } | null;
        userErrors: { field?: string[]; message: string }[];
      };
    }>(
      `
      mutation CreateStorefrontToken($input: StorefrontAccessTokenInput!) {
        storefrontAccessTokenCreate(input: $input) {
          storefrontAccessToken {
            accessToken
            title
            accessScopes { handle }
          }
          userErrors { field message }
        }
      }
    `,
      {
        input: {
          title: `LinxLiving Headless ${new Date().toISOString().slice(0, 10)}`,
        },
      },
    );

    const payload = data.storefrontAccessTokenCreate;
    if (payload.userErrors?.length) {
      return NextResponse.json(
        {
          error: payload.userErrors.map((e) => e.message).join("; "),
        },
        { status: 400 },
      );
    }

    const token = payload.storefrontAccessToken?.accessToken;
    if (!token) {
      return NextResponse.json(
        { error: "Shopify did not return a Storefront token" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      accessToken: token,
      scopes:
        payload.storefrontAccessToken?.accessScopes?.map((s) => s.handle) ||
        [],
      hint: "Add to .env as SHOPIFY_STOREFRONT_ACCESS_TOKEN, set SHOPIFY_CHECKOUT_ENABLED=true and NEXT_PUBLIC_SHOPIFY_CHECKOUT_ENABLED=true, then restart the server.",
    });
  } catch (error) {
    console.error("Storefront token create error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create Storefront token";

    const accessDenied = /access denied/i.test(message);
    return NextResponse.json(
      {
        error: accessDenied
          ? "Access denied: your Shopify app needs Storefront (unauthenticated) scopes. Add them in Dev Dashboard, release, reinstall, then try again."
          : message,
        fix: accessDenied
          ? {
              steps: [
                "Open https://dev.shopify.com/dashboard → LinxSquare Connector",
                "Edit the app version → Access scopes",
                "Add REQUIRED (not optional): unauthenticated_read_product_listings, unauthenticated_read_checkouts, unauthenticated_write_checkouts",
                "Release the version, then reinstall the app on wnbgk0-xu.myshopify.com",
                "Return here and click Create Storefront token again",
              ],
              scopes: [
                "unauthenticated_read_product_listings",
                "unauthenticated_read_checkouts",
                "unauthenticated_write_checkouts",
              ],
            }
          : undefined,
      },
      { status: accessDenied ? 403 : 500 },
    );
  }
}

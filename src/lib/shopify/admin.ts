import {
  getShopifyConfig,
  shopifyAdminGraphqlUrl,
  type ShopifyConfig,
} from "./config";
import { clearAdminAccessTokenCache, getAdminAccessToken } from "./auth";
import type { ShopifyUserError } from "./types";

export class ShopifyAdminError extends Error {
  constructor(
    message: string,
    public userErrors: ShopifyUserError[] = [],
    public status?: number,
  ) {
    super(message);
    this.name = "ShopifyAdminError";
  }
}

type GraphqlResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

export async function shopifyAdminRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  configOverride?: ShopifyConfig,
): Promise<T> {
  const config = configOverride ?? getShopifyConfig();
  if (!config) {
    throw new ShopifyAdminError(
      "Shopify is not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or legacy SHOPIFY_ADMIN_ACCESS_TOKEN).",
    );
  }

  const accessToken = await getAdminAccessToken(config);

  const res = await fetch(shopifyAdminGraphqlUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (res.status === 401) {
    clearAdminAccessTokenCache();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ShopifyAdminError(
      `Shopify Admin API HTTP ${res.status}: ${text.slice(0, 300)}`,
      [],
      res.status,
    );
  }

  const json = (await res.json()) as GraphqlResponse<T>;
  if (json.errors?.length) {
    throw new ShopifyAdminError(
      json.errors.map((e) => e.message).join("; "),
    );
  }
  if (!json.data) {
    throw new ShopifyAdminError("Shopify Admin API returned no data");
  }
  return json.data;
}

export async function getPrimaryLocationId(): Promise<string | null> {
  const data = await shopifyAdminRequest<{
    locations: { nodes: { id: string; name: string; isActive: boolean }[] };
  }>(`
    query PrimaryLocation {
      locations(first: 10, includeInactive: false) {
        nodes { id name isActive }
      }
    }
  `);

  const active = data.locations.nodes.find((l) => l.isActive);
  return active?.id ?? data.locations.nodes[0]?.id ?? null;
}

export async function shopifyAdminHealthcheck(): Promise<{
  ok: boolean;
  shop?: string;
  locationId?: string | null;
  error?: string;
  authMode?: "client_credentials" | "static_token";
}> {
  try {
    const config = getShopifyConfig();
    const authMode =
      config?.clientId && config.clientSecret
        ? "client_credentials"
        : "static_token";

    const data = await shopifyAdminRequest<{
      shop: { name: string; myshopifyDomain: string };
    }>(`
      query ShopInfo {
        shop { name myshopifyDomain }
      }
    `);
    const locationId = await getPrimaryLocationId();
    return {
      ok: true,
      shop: `${data.shop.name} (${data.shop.myshopifyDomain})`,
      locationId,
      authMode,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

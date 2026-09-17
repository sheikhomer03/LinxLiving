import {
  getShopifyConfig,
  shopifyAdminGraphqlUrl,
  type ShopifyConfig,
} from "./config";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

/**
 * Ceiling for the token exchange. Deliberately shorter than the Admin
 * client's request timeout: a webhook has roughly five seconds to answer, so
 * failing fast here is more useful than waiting out a stalled connection.
 */
const TOKEN_TIMEOUT_MS = Number(process.env.SHOPIFY_TOKEN_TIMEOUT_MS) || 15_000;

let cachedToken: CachedToken | null = null;

/**
 * Resolve an Admin API access token.
 * Prefers client credentials (Dev Dashboard) and falls back to a static token.
 */
export async function getAdminAccessToken(
  configOverride?: ShopifyConfig,
): Promise<string> {
  const config = configOverride ?? getShopifyConfig();
  if (!config) {
    throw new Error(
      "Shopify is not configured. Set SHOPIFY_STORE_DOMAIN and either SHOPIFY_CLIENT_ID+SHOPIFY_CLIENT_SECRET or SHOPIFY_ADMIN_ACCESS_TOKEN.",
    );
  }

  if (config.clientId && config.clientSecret) {
    const now = Date.now();
    if (cachedToken && now < cachedToken.expiresAt - 60_000) {
      return cachedToken.accessToken;
    }

    // Bounded like every other Shopify call. Without a signal this fetch can
    // hang indefinitely — and because every Admin request needs a token
    // first, a stall here never reaches the GraphQL client's own timeout. A
    // webhook handler waiting on it simply never answers, which Shopify sees
    // as a failed delivery and retries.
    const res = await fetch(
      `https://${config.storeDomain}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Shopify token request failed (${res.status}): ${text.slice(0, 400)}`,
      );
    }

    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!json.access_token) {
      throw new Error(
        json.error_description ||
          json.error ||
          "Shopify token response missing access_token",
      );
    }

    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 86399;
    cachedToken = {
      accessToken: json.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return cachedToken.accessToken;
  }

  if (config.adminAccessToken) {
    return config.adminAccessToken;
  }

  throw new Error(
    "Missing Shopify credentials. Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (Dev Dashboard) or SHOPIFY_ADMIN_ACCESS_TOKEN.",
  );
}

/** Clear cached token (e.g. after auth errors). */
export function clearAdminAccessTokenCache() {
  cachedToken = null;
}

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
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      throttleStatus?: {
        currentlyAvailable?: number;
        restoreRate?: number;
      };
    };
  };
};

export type ShopifyRequestOptions = {
  /** Skip waiting/retries when the shared throttle cooldown is active. */
  failFastOnThrottle?: boolean;
  maxAttempts?: number;
};

/** Shared cooldown so webhooks + auto-sync stop stampeding Shopify. */
let throttleCooldownUntil = 0;
let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const MIN_GAP_MS = 200;

function isThrottleMessage(message: string) {
  return /throttl/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isShopifyThrottled() {
  return Date.now() < throttleCooldownUntil;
}

export function markShopifyThrottled(ms = 10_000) {
  throttleCooldownUntil = Math.max(throttleCooldownUntil, Date.now() + ms);
}

export function shopifyThrottleRemainingMs() {
  return Math.max(0, throttleCooldownUntil - Date.now());
}

function enqueueShopify<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const waitGap = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestAt));
    if (waitGap) await sleep(waitGap);
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if one request fails
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function shopifyAdminRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  options?: ShopifyRequestOptions & { config?: ShopifyConfig },
): Promise<T> {
  const config = options?.config ?? getShopifyConfig();
  if (!config) {
    throw new ShopifyAdminError(
      "Shopify is not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or legacy SHOPIFY_ADMIN_ACCESS_TOKEN).",
    );
  }

  if (options?.failFastOnThrottle && isShopifyThrottled()) {
    throw new ShopifyAdminError("Throttled");
  }

  const maxAttempts = Math.max(1, options?.maxAttempts ?? 4);

  return enqueueShopify(async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (isShopifyThrottled()) {
        if (options?.failFastOnThrottle) {
          throw new ShopifyAdminError("Throttled");
        }
        await sleep(shopifyThrottleRemainingMs() + 50);
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

      if (res.status === 429) {
        markShopifyThrottled(12_000);
        if (attempt < maxAttempts - 1 && !options?.failFastOnThrottle) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : shopifyThrottleRemainingMs() || 2000;
          await sleep(waitMs);
          continue;
        }
        const text = await res.text().catch(() => "");
        throw new ShopifyAdminError(
          `Shopify Admin API HTTP 429: ${text.slice(0, 300)}`,
          [],
          429,
        );
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
        const msg = json.errors.map((e) => e.message).join("; ");
        const throttled =
          isThrottleMessage(msg) ||
          json.errors.some((e) => e.extensions?.code === "THROTTLED");

        if (throttled) {
          const restore =
            json.extensions?.cost?.throttleStatus?.restoreRate ?? 50;
          const available =
            json.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 0;
          const waitMs = Math.max(
            2500,
            Math.ceil(((1000 - available) / Math.max(restore, 1)) * 1000),
            1500 * 2 ** attempt,
          );
          markShopifyThrottled(waitMs);
          if (attempt < maxAttempts - 1 && !options?.failFastOnThrottle) {
            await sleep(waitMs);
            continue;
          }
          throw new ShopifyAdminError("Throttled");
        }

        throw new ShopifyAdminError(msg);
      }
      if (!json.data) {
        throw new ShopifyAdminError("Shopify Admin API returned no data");
      }
      return json.data;
    }

    throw new ShopifyAdminError("Shopify Admin API exhausted retries");
  });
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

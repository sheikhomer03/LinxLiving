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
      actualQueryCost?: number;
      requestedQueryCost?: number;
      throttleStatus?: {
        currentlyAvailable?: number;
        maximumAvailable?: number;
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
let lastRequestAt = 0;

function envNumber(name: string, fallback: number, min: number) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min ? raw : fallback;
}

/**
 * Pacing. The defaults — one request at a time, 200ms apart — are what a web
 * request or a webhook should use: a page render must not be able to exhaust
 * the shop's rate limit for everything else.
 *
 * A catalogue-wide backfill is the opposite case. It is the only caller in its
 * process, it has tens of thousands of products to get through, and Shopify's
 * bucket (2000 points, refilling at 100/s) is far from spent at 5 requests a
 * second. `scripts/sync-all-products-to-shopify.cjs` raises both through the
 * environment rather than reaching past this module with its own HTTP client,
 * so the backfill and production keep running the same code.
 */
const MIN_GAP_MS = envNumber("SHOPIFY_MIN_GAP_MS", 200, 0);
const MAX_CONCURRENCY = envNumber("SHOPIFY_MAX_CONCURRENCY", 1, 1);
/** Ceiling on a single Admin API call. Media mutations are the slow ones. */
const REQUEST_TIMEOUT_MS = envNumber("SHOPIFY_REQUEST_TIMEOUT_MS", 60_000, 5_000);

/**
 * A local mirror of the shop's leaky bucket.
 *
 * Shopify reports the bucket on every reply — points left, ceiling, and refill
 * rate. Modelling it here lets a bulk run stay just under the limit instead of
 * discovering it by being rejected, which matters more than it sounds: a
 * throttled reply costs the round trip *and* trips a shared cooldown that stalls
 * every other request in flight. Overshooting once is far more expensive than
 * waiting a few hundred milliseconds.
 *
 * `reserved` is what in-flight requests are expected to spend but have not been
 * billed for yet. Without it, a dozen concurrent callers each read the same
 * healthy balance and fire together, which is exactly the overshoot to avoid.
 */
let pointsAvailable = Infinity;
let pointsUpdatedAt = Date.now();
let pointsMaximum = 2000;
let pointsRestoreRate = 100;
let pointsReserved = 0;
/** Rolling estimate of what one request costs, seeded at a product create. */
let estimatedRequestCost = 30;

function projectedPoints() {
  if (!Number.isFinite(pointsAvailable)) return Infinity;
  const restored = ((Date.now() - pointsUpdatedAt) / 1000) * pointsRestoreRate;
  return Math.min(pointsMaximum, pointsAvailable + restored) - pointsReserved;
}

/** Counters for operators watching a bulk run; cheap enough to always keep. */
const stats = { requests: 0, retries: 0, waitMs: 0, latencyMs: 0, inFlightPeak: 0 };

export function shopifyCostStatus() {
  return {
    available: pointsAvailable,
    projected: projectedPoints(),
    restoreRate: pointsRestoreRate,
    estimatedRequestCost: Math.round(estimatedRequestCost),
    ...stats,
    avgLatencyMs: stats.requests ? Math.round(stats.latencyMs / stats.requests) : 0,
  };
}

let activeRequests = 0;
const waiting: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENCY) {
    activeRequests += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) next();
  else activeRequests -= 1;
}

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

/** Points held back so a burst of cheap queries cannot starve a mutation. */
const COST_FLOOR = envNumber("SHOPIFY_COST_FLOOR", 100, 0);

/**
 * Wait until this request's likely cost fits in the bucket, then reserve it.
 * Returns what was reserved so the caller can release it when the bill lands.
 */
async function reserveCostHeadroom(): Promise<number> {
  const cost = estimatedRequestCost;
  for (;;) {
    const projected = projectedPoints();
    if (!Number.isFinite(projected) || projected >= cost + COST_FLOOR) break;
    const deficit = cost + COST_FLOOR - projected;
    await sleep(
      Math.min(2000, Math.max(50, (deficit / Math.max(pointsRestoreRate, 1)) * 1000)),
    );
  }
  pointsReserved += cost;
  return cost;
}

async function enqueueShopify<T>(fn: () => Promise<T>): Promise<T> {
  const queuedAt = Date.now();
  await acquireSlot();
  try {
    const waitGap = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestAt));
    if (waitGap) await sleep(waitGap);
    const reserved = await reserveCostHeadroom();
    lastRequestAt = Date.now();
    stats.waitMs += lastRequestAt - queuedAt;
    stats.inFlightPeak = Math.max(stats.inFlightPeak, activeRequests);
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      pointsReserved = Math.max(0, pointsReserved - reserved);
      stats.requests += 1;
      stats.latencyMs += Date.now() - startedAt;
    }
  } finally {
    releaseSlot();
  }
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

      let res: Response;
      try {
        res = await fetch(shopifyAdminGraphqlUrl(config), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({ query, variables }),
          cache: "no-store",
          // Without this a stalled socket hangs the caller indefinitely; a bulk
          // run then spends minutes on a request that will never answer.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        // A dropped connection or timeout is not a rejection by Shopify — the
        // mutation may not even have been read. Retrying is both safe and the
        // only way a run of tens of thousands of requests survives a blip.
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts - 1) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ShopifyAdminError(`Shopify Admin API request failed: ${message}`);
      }

      if (res.status === 401) {
        clearAdminAccessTokenCache();
      }

      if (res.status === 429) {
        // Long enough to let the bucket refill past what a request needs, not
        // so long that one rejection idles every other worker for ten seconds.
        markShopifyThrottled(
          Math.ceil(
            ((estimatedRequestCost + COST_FLOOR) /
              Math.max(pointsRestoreRate, 1)) *
              1000,
          ),
        );
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

      const cost = json.extensions?.cost;
      const throttleStatus = cost?.throttleStatus;
      if (throttleStatus?.currentlyAvailable != null) {
        pointsAvailable = throttleStatus.currentlyAvailable;
        pointsUpdatedAt = Date.now();
        pointsMaximum = throttleStatus.maximumAvailable ?? pointsMaximum;
        pointsRestoreRate = throttleStatus.restoreRate ?? pointsRestoreRate;
      }
      if (cost?.actualQueryCost != null) {
        // Weighted toward the recent past: a run moves between cheap queries
        // and expensive creates, and the estimate should follow it.
        estimatedRequestCost =
          estimatedRequestCost * 0.8 + cost.actualQueryCost * 0.2;
      }

      if (json.errors?.length) {
        const msg = json.errors.map((e) => e.message).join("; ");
        const throttled =
          isThrottleMessage(msg) ||
          json.errors.some((e) => e.extensions?.code === "THROTTLED");

        if (throttled) {
          const restore = throttleStatus?.restoreRate ?? 50;
          const available = throttleStatus?.currentlyAvailable ?? 0;
          // Wait for what this request actually needs, not for a full bucket.
          const needed = Math.max(
            0,
            estimatedRequestCost + COST_FLOOR - available,
          );
          const waitMs = Math.max(
            500,
            Math.ceil((needed / Math.max(restore, 1)) * 1000),
            500 * 2 ** attempt,
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

/**
 * Primary location, resolved once per process.
 *
 * Every product create and every stock push needs it, and the shop's locations
 * do not change while a sync runs — re-reading it per product was two extra
 * requests on each of eighteen thousand products.
 */
let primaryLocationId: string | null | undefined;

export async function getPrimaryLocationId(): Promise<string | null> {
  if (primaryLocationId !== undefined) return primaryLocationId;

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
  primaryLocationId = active?.id ?? data.locations.nodes[0]?.id ?? null;
  return primaryLocationId;
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

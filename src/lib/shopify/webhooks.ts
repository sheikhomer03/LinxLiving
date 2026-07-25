import { shopifyAdminRequest } from "./admin";

const TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "COLLECTIONS_CREATE",
  "COLLECTIONS_UPDATE",
  "COLLECTIONS_DELETE",
  "CUSTOMERS_CREATE",
  "CUSTOMERS_UPDATE",
  "CUSTOMERS_DELETE",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "DISCOUNTS_CREATE",
  "DISCOUNTS_UPDATE",
  "DISCOUNTS_DELETE",
] as const;

/**
 * Register HTTPS webhooks for two-way inbound sync.
 */
export async function registerProductWebhooks(callbackBaseUrl: string) {
  const base = callbackBaseUrl.replace(/\/$/, "");
  const callbackUrl = `${base}/api/webhooks/shopify`;

  const existing = await shopifyAdminRequest<{
    webhookSubscriptions: {
      nodes: {
        id: string;
        topic: string;
        endpoint: { callbackUrl?: string; __typename?: string };
      }[];
    };
  }>(`
    query ExistingWebhooks {
      webhookSubscriptions(first: 100) {
        nodes {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint { callbackUrl }
          }
        }
      }
    }
  `);

  const results: {
    topic: string;
    action: "created" | "exists" | "error";
    id?: string;
    error?: string;
  }[] = [];

  for (const topic of TOPICS) {
    const already = existing.webhookSubscriptions.nodes.find((n) => {
      const url = n.endpoint?.callbackUrl?.replace(/\/$/, "");
      return n.topic === topic && url === callbackUrl;
    });
    if (already) {
      results.push({ topic, action: "exists", id: already.id });
      continue;
    }

    try {
      const data = await shopifyAdminRequest<{
        webhookSubscriptionCreate: {
          webhookSubscription: { id: string; topic: string } | null;
          userErrors: { field?: string[]; message: string }[];
        };
      }>(
        `
        mutation CreateWebhook(
          $topic: WebhookSubscriptionTopic!
          $webhookSubscription: WebhookSubscriptionInput!
        ) {
          webhookSubscriptionCreate(
            topic: $topic
            webhookSubscription: $webhookSubscription
          ) {
            webhookSubscription { id topic }
            userErrors { field message }
          }
        }
      `,
        {
          topic,
          webhookSubscription: {
            uri: callbackUrl,
            format: "JSON",
          },
        },
      );

      if (data.webhookSubscriptionCreate.userErrors.length) {
        results.push({
          topic,
          action: "error",
          error: data.webhookSubscriptionCreate.userErrors
            .map((e) => e.message)
            .join("; "),
        });
        continue;
      }

      results.push({
        topic,
        action: "created",
        id: data.webhookSubscriptionCreate.webhookSubscription?.id,
      });
    } catch (error) {
      results.push({
        topic,
        action: "error",
        error: error instanceof Error ? error.message : "Failed",
      });
    }
  }

  return { callbackUrl, results };
}

export async function listShopifyWebhooks() {
  const data = await shopifyAdminRequest<{
    webhookSubscriptions: {
      nodes: {
        id: string;
        topic: string;
        endpoint: { callbackUrl?: string };
      }[];
    };
  }>(`
    query ListWebhooks {
      webhookSubscriptions(first: 100) {
        nodes {
          id
          topic
          endpoint {
            ... on WebhookHttpEndpoint { callbackUrl }
          }
        }
      }
    }
  `);

  return data.webhookSubscriptions.nodes;
}

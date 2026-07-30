import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getShopifyConfig } from "@/lib/shopify/config";
import {
  deleteMongoProductByShopifyId,
  mapRestWebhookProduct,
  upsertMongoProductFromShopify,
} from "@/lib/shopify/inbound";
import { pullShopifyProductById } from "@/lib/shopify/pull-products";
import {
  deleteMongoCollectionOrBrandByShopifyId,
  upsertMongoCollectionFromShopify,
} from "@/lib/shopify/sync-collection";
import {
  upsertMongoCustomerFromShopify,
  upsertMongoOrderFromShopify,
} from "@/lib/shopify/sync-commerce";
import {
  deleteMongoCouponByShopifyId,
  pullDiscountsFromShopify,
} from "@/lib/shopify/sync-coupon";
import { shopifyAdminRequest, isShopifyThrottled } from "@/lib/shopify/admin";
import { toShopifyGid } from "@/lib/shopify/helpers";
import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

function verifyShopifyHmac(rawBody: string, hmacHeader: string | null) {
  const config = getShopifyConfig();
  const secret = config?.clientSecret;
  if (!secret || !hmacHeader) return false;

  const digest = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    const a = Buffer.from(digest);
    const b = Buffer.from(hmacHeader);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = (req.headers.get("x-shopify-topic") || "").toLowerCase();
  const shop = req.headers.get("x-shopify-shop-domain");

  if (!verifyShopifyHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  const config = getShopifyConfig();
  if (
    config?.storeDomain &&
    shop &&
    shop.replace(/\/$/, "") !== config.storeDomain
  ) {
    return NextResponse.json({ error: "Unexpected shop" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (topic === "products/delete") {
      const result = await deleteMongoProductByShopifyId(payload.id);
      return NextResponse.json({ ok: true, topic, ...result });
    }

    if (topic === "products/create" || topic === "products/update") {
      // Prefer GraphQL for linx.* metafields — but during throttle storms use REST
      // immediately so parallel webhooks don't amplify rate limits.
      const useRestFallback = async (reason: string) => {
        const mapped = mapRestWebhookProduct(payload);
        const result = await upsertMongoProductFromShopify(mapped);
        return NextResponse.json({
          ok: true,
          topic,
          fallback: "rest",
          reason,
          ...result,
        });
      };

      if (isShopifyThrottled()) {
        return useRestFallback("throttle-cooldown");
      }

      try {
        const result = await pullShopifyProductById(payload.id, {
          failFastOnThrottle: true,
          maxAttempts: 1,
        });
        revalidatePath("/admin/products");
        revalidatePath("/");
        return NextResponse.json({ ok: true, topic, ...result });
      } catch (firstError) {
        const firstMsg =
          firstError instanceof Error ? firstError.message : String(firstError);
        if (/throttl/i.test(firstMsg) || isShopifyThrottled()) {
          return useRestFallback("throttled");
        }
        try {
          await new Promise((r) => setTimeout(r, 400));
          const result = await pullShopifyProductById(payload.id, {
            failFastOnThrottle: true,
            maxAttempts: 1,
          });
          revalidatePath("/admin/products");
          revalidatePath("/");
          return NextResponse.json({
            ok: true,
            topic,
            retried: true,
            ...result,
          });
        } catch {
          return useRestFallback("graphql-failed");
        }
      }
    }

    if (topic === "collections/delete") {
      const result = await deleteMongoCollectionOrBrandByShopifyId(payload.id);
      return NextResponse.json({ ok: true, topic, ...result });
    }

    if (topic === "collections/create" || topic === "collections/update") {
      const gid = toShopifyGid("Collection", payload.id);
      const data = await shopifyAdminRequest<{ product: any; collection: any }>(
        `
        query OneCollection($id: ID!) {
          collection(id: $id) {
            id title handle descriptionHtml
            image { url }
            products(first: 50) { nodes { id } }
          }
        }
      `,
        { id: gid },
      ).catch(() => null);

      const result = data?.collection
        ? await upsertMongoCollectionFromShopify(data.collection)
        : await upsertMongoCollectionFromShopify({
            id: gid,
            title: payload.title,
            handle: payload.handle,
            descriptionHtml: payload.body_html,
            image: payload.image,
            products: { nodes: [] },
          });
      return NextResponse.json({ ok: true, topic, ...result });
    }

    if (topic === "customers/delete") {
      await connectDB();
      const gid = toShopifyGid("Customer", payload.id);
      await User.findOneAndUpdate(
        { shopifyCustomerId: gid },
        { $unset: { shopifyCustomerId: 1 } },
      );
      return NextResponse.json({ ok: true, topic });
    }

    if (topic === "customers/create" || topic === "customers/update") {
      await upsertMongoCustomerFromShopify({
        id: toShopifyGid("Customer", payload.id),
        email: payload.email,
        firstName: payload.first_name,
        lastName: payload.last_name,
        displayName: [payload.first_name, payload.last_name]
          .filter(Boolean)
          .join(" "),
      });
      revalidatePath("/admin/customers");
      return NextResponse.json({ ok: true, topic });
    }

    if (
      topic === "orders/create" ||
      topic === "orders/updated" ||
      topic === "orders/cancelled"
    ) {
      const gid = toShopifyGid("Order", payload.id);
      try {
        const data = await shopifyAdminRequest<{ order: any }>(
          `
          query OneOrder($id: ID!) {
            order(id: $id) {
              id name email cancelledAt
              displayFulfillmentStatus displayFinancialStatus
              totalPriceSet { shopMoney { amount } }
              totalDiscountsSet { shopMoney { amount } }
              customer { id email }
              shippingAddress {
                firstName lastName address1 city zip country phone countryCodeV2
              }
              lineItems(first: 50) {
                nodes {
                  id title quantity
                  originalUnitPriceSet { shopMoney { amount } }
                  image { url }
                  variant { id image { url } product { id } }
                  product { id }
                }
              }
            }
          }
        `,
          { id: gid },
        );
        if (data.order) await upsertMongoOrderFromShopify(data.order);
      } catch {
        // REST payload fallback is limited; ignore if GraphQL fails
      }
      revalidatePath("/admin/orders");
      return NextResponse.json({ ok: true, topic });
    }

    if (topic === "discounts/delete") {
      const result = await deleteMongoCouponByShopifyId(payload.admin_graphql_api_id || payload.id);
      return NextResponse.json({ ok: true, topic, ...result });
    }

    if (topic === "discounts/create" || topic === "discounts/update") {
      await pullDiscountsFromShopify(50);
      return NextResponse.json({ ok: true, topic });
    }

    return NextResponse.json({ ok: true, ignored: topic });
  } catch (error) {
    console.error("Shopify webhook error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Webhook handler failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "shopify-webhooks" });
}

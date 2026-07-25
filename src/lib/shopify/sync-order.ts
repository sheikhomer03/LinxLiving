import { shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { User } from "@/models/User";
import { pushCustomerToShopify } from "./sync-commerce";

/**
 * Push a Linx COD/local order into Shopify as a completed draft order.
 */
export async function pushOrderToShopify(order: {
  _id: { toString(): string };
  orderNumber?: string;
  items: {
    product?: any;
    name: string;
    price: number;
    quantity: number;
  }[];
  totalAmount: number;
  shippingAddress?: any;
  shippingMethod?: string;
  paymentMethod?: string;
  couponCode?: string | null;
  discountAmount?: number;
  shopifyOrderId?: string | null;
}) {
  if (!isShopifySyncEnabled()) return null;
  if (order.shopifyOrderId) return order.shopifyOrderId;

  await connectDB();

  const email = String(order.shippingAddress?.email || "").toLowerCase().trim();
  let customerId: string | null = null;
  if (email) {
    const user = await User.findOne({ email }).select("name shopifyCustomerId");
    if (user) {
      customerId =
        (await pushCustomerToShopify({
          name: user.name || email,
          email,
          shopifyCustomerId: user.shopifyCustomerId,
        })) || null;
      if (customerId && customerId !== user.shopifyCustomerId) {
        user.shopifyCustomerId = customerId;
        user.shopifySyncedAt = new Date();
        await user.save();
      }
    } else {
      customerId = await pushCustomerToShopify({
        name:
          [order.shippingAddress?.firstName, order.shippingAddress?.lastName]
            .filter(Boolean)
            .join(" ") || email,
        email,
      });
    }
  }

  const lineItems: { variantId: string; quantity: number }[] = [];
  for (const item of order.items) {
    const productId = item.product?.toString?.() || item.product;
    const product = await Product.findById(productId)
      .select("shopifyVariantId name")
      .lean();
    const variantId = (product as any)?.shopifyVariantId;
    if (!variantId) {
      throw new Error(
        `Product "${item.name}" is not synced to Shopify (missing variant)`,
      );
    }
    lineItems.push({
      variantId,
      quantity: Math.max(1, Number(item.quantity) || 1),
    });
  }

  if (!lineItems.length) {
    throw new Error("No Shopify line items for order");
  }

  const addr = order.shippingAddress || {};
  const draftInput: Record<string, unknown> = {
    note: `Linx ${order.paymentMethod || "order"} ${order.orderNumber || ""}`.trim(),
    tags: ["linx", order.paymentMethod === "Cash on Delivery" ? "cod" : "local"],
    lineItems,
    shippingLine: order.shippingMethod
      ? { title: order.shippingMethod, price: "0.00" }
      : undefined,
    shippingAddress: {
      firstName: addr.firstName || "",
      lastName: addr.lastName || "",
      address1: addr.address || addr.address1 || "",
      address2: addr.address2 || "",
      city: addr.city || "",
      province: addr.county || addr.province || "",
      zip: addr.postcode || addr.zip || "",
      country: addr.country || "GB",
      phone: addr.phone || "",
    },
  };

  if (email) draftInput.email = email;
  if (customerId) draftInput.customerId = customerId;
  if (order.couponCode) {
    draftInput.appliedDiscount = {
      title: order.couponCode,
      value: Number(order.discountAmount || 0),
      valueType: "FIXED_AMOUNT",
    };
  }

  const created = await shopifyAdminRequest<{
    draftOrderCreate: {
      draftOrder: { id: string } | null;
      userErrors: { message: string }[];
    };
  }>(
    `
    mutation CreateDraft($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id }
        userErrors { message }
      }
    }
  `,
    { input: draftInput },
  );

  if (created.draftOrderCreate.userErrors.length) {
    throw new Error(
      created.draftOrderCreate.userErrors.map((e) => e.message).join("; "),
    );
  }

  const draftId = created.draftOrderCreate.draftOrder?.id;
  if (!draftId) throw new Error("Shopify draftOrderCreate returned no id");

  const completed = await shopifyAdminRequest<{
    draftOrderComplete: {
      draftOrder: { order: { id: string } | null } | null;
      userErrors: { message: string }[];
    };
  }>(
    `
    mutation CompleteDraft($id: ID!) {
      draftOrderComplete(id: $id) {
        draftOrder { order { id } }
        userErrors { message }
      }
    }
  `,
    { id: draftId },
  );

  if (completed.draftOrderComplete.userErrors.length) {
    throw new Error(
      completed.draftOrderComplete.userErrors.map((e) => e.message).join("; "),
    );
  }

  return completed.draftOrderComplete.draftOrder?.order?.id ?? null;
}

async function fulfillShopifyOrder(shopifyOrderId: string) {
  const data = await shopifyAdminRequest<{
    order: {
      id: string;
      fulfillmentOrders: {
        nodes: {
          id: string;
          status: string;
          lineItems: {
            nodes: { id: string; remainingQuantity: number }[];
          };
        }[];
      };
    } | null;
  }>(
    `
    query OrderFulfillments($id: ID!) {
      order(id: $id) {
        id
        fulfillmentOrders(first: 10) {
          nodes {
            id
            status
            lineItems(first: 50) {
              nodes { id remainingQuantity }
            }
          }
        }
      }
    }
  `,
    { id: shopifyOrderId },
  );

  const open = (data.order?.fulfillmentOrders?.nodes || []).filter((fo) =>
    ["OPEN", "IN_PROGRESS", "SCHEDULED"].includes(
      String(fo.status || "").toUpperCase(),
    ),
  );

  for (const fo of open) {
    const lineItems = (fo.lineItems?.nodes || [])
      .filter((li) => li.remainingQuantity > 0)
      .map((li) => ({
        id: li.id,
        quantity: li.remainingQuantity,
      }));
    if (!lineItems.length) continue;

    const result = await shopifyAdminRequest<{
      fulfillmentCreateV2: {
        userErrors: { message: string }[];
      };
    }>(
      `
      mutation Fulfill($fulfillment: FulfillmentV2Input!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          userErrors { message }
        }
      }
    `,
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: [
            {
              fulfillmentOrderId: fo.id,
              fulfillmentOrderLineItems: lineItems,
            },
          ],
          notifyCustomer: true,
        },
      },
    );

    if (result.fulfillmentCreateV2.userErrors.length) {
      throw new Error(
        result.fulfillmentCreateV2.userErrors.map((e) => e.message).join("; "),
      );
    }
  }
}

async function cancelShopifyOrder(shopifyOrderId: string) {
  const data = await shopifyAdminRequest<{
    orderCancel: {
      orderCancelUserErrors: { message: string }[];
    };
  }>(
    `
    mutation CancelOrder(
      $orderId: ID!
      $reason: OrderCancelReason!
      $notifyCustomer: Boolean!
      $refund: Boolean!
      $restock: Boolean!
    ) {
      orderCancel(
        orderId: $orderId
        reason: $reason
        notifyCustomer: $notifyCustomer
        refund: $refund
        restock: $restock
      ) {
        orderCancelUserErrors { message }
      }
    }
  `,
    {
      orderId: shopifyOrderId,
      reason: "OTHER",
      notifyCustomer: true,
      refund: false,
      restock: true,
    },
  );

  if (data.orderCancel.orderCancelUserErrors.length) {
    throw new Error(
      data.orderCancel.orderCancelUserErrors.map((e) => e.message).join("; "),
    );
  }
}

/**
 * Mirror Linx admin status changes onto Shopify (fulfill / cancel).
 */
export async function pushOrderStatusToShopify(
  shopifyOrderId: string,
  status: string,
) {
  if (!isShopifySyncEnabled() || !shopifyOrderId) return;

  if (status === "Cancelled") {
    await cancelShopifyOrder(shopifyOrderId);
    return;
  }

  if (
    status === "Shipped" ||
    status === "Out for Delivery" ||
    status === "Delivered"
  ) {
    await fulfillShopifyOrder(shopifyOrderId);
  }
}

export async function listShopifyPaidOrders(limit = 50) {
  await connectDB();
  const orders = await Order.find({
    $or: [
      { paymentMethod: "Shopify" },
      { shopifyOrderId: { $nin: [null, ""] } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return orders.map((o: any) => ({
    id: o.shopifyOrderId || o._id.toString(),
    mongoId: o._id.toString(),
    orderNumber: o.orderNumber,
    amount: o.totalAmount,
    currency: "GBP",
    status: o.paymentStatus,
    fulfillment: o.status,
    email: o.shippingAddress?.email || "",
    created: o.createdAt,
    paymentMethod: o.paymentMethod,
    source: "shopify",
  }));
}

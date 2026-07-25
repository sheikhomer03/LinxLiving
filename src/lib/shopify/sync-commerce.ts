import { shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import { toShopifyGid } from "./helpers";
import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

function mapShopifyOrderStatus(displayFulfillmentStatus?: string, cancelledAt?: string | null) {
  if (cancelledAt) return "Cancelled";
  const s = String(displayFulfillmentStatus || "").toUpperCase();
  if (s.includes("FULFILLED")) return "Delivered";
  if (s.includes("IN_PROGRESS") || s.includes("PARTIAL")) return "Shipped";
  if (s.includes("UNFULFILLED") || s.includes("ON_HOLD")) return "Processing";
  return "Confirmed Order";
}

function mapPaymentStatus(displayFinancialStatus?: string) {
  const s = String(displayFinancialStatus || "").toUpperCase();
  if (s.includes("PAID") || s.includes("PARTIALLY_PAID")) return "Paid";
  if (s.includes("VOIDED") || s.includes("REFUNDED")) return "Failed";
  return "Pending";
}

export async function upsertMongoCustomerFromShopify(node: any) {
  await connectDB();
  const shopifyCustomerId = node.id?.startsWith("gid://")
    ? node.id
    : toShopifyGid("Customer", node.id);
  const email = String(node.email || "").toLowerCase().trim();
  if (!email) return null;

  const name =
    [node.firstName, node.lastName].filter(Boolean).join(" ").trim() ||
    node.displayName ||
    email;

  const existing = await User.findOne({
    $or: [{ shopifyCustomerId }, { email }],
  });

  if (existing) {
    existing.name = name;
    existing.shopifyCustomerId = shopifyCustomerId;
    existing.shopifySyncedAt = new Date();
    if (existing.role !== "admin") existing.role = "user";
    await existing.save();
    return existing;
  }

  const randomPassword = await bcrypt.hash(
    `shopify-${shopifyCustomerId}-${Date.now()}`,
    12,
  );

  return User.create({
    name,
    email,
    password: randomPassword,
    role: "user",
    shopifyCustomerId,
    shopifySyncedAt: new Date(),
  });
}

export async function pullCustomersFromShopify(first = 50) {
  const data = await shopifyAdminRequest<{
    customers: { nodes: any[] };
  }>(
    `
    query Customers($first: Int!) {
      customers(first: $first, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          email
          firstName
          lastName
          displayName
        }
      }
    }
  `,
    { first },
  );

  let pulled = 0;
  for (const node of data.customers.nodes) {
    const saved = await upsertMongoCustomerFromShopify(node);
    if (saved) pulled += 1;
  }
  revalidatePath("/admin/customers");
  return { pulled };
}

export async function pushCustomerToShopify(input: {
  name: string;
  email: string;
  shopifyCustomerId?: string | null;
}) {
  if (!isShopifySyncEnabled()) return null;
  if (input.shopifyCustomerId) return input.shopifyCustomerId;

  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const lastName = rest.join(" ");

  const data = await shopifyAdminRequest<{
    customerCreate: {
      customer: { id: string } | null;
      userErrors: { message: string }[];
    };
  }>(
    `
    mutation CreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { message }
      }
    }
  `,
    {
      input: {
        email: input.email,
        firstName: firstName || input.email,
        lastName: lastName || undefined,
      },
    },
  );

  if (data.customerCreate.userErrors.length) {
    throw new Error(data.customerCreate.userErrors.map((e) => e.message).join("; "));
  }
  return data.customerCreate.customer?.id ?? null;
}

export async function upsertMongoOrderFromShopify(node: any) {
  await connectDB();
  const shopifyOrderId = node.id?.startsWith("gid://")
    ? node.id
    : toShopifyGid("Order", node.id);

  const email = String(
    node.email || node.customer?.email || "",
  ).toLowerCase();
  let userId = null as any;
  if (email) {
    const user = await User.findOne({ email }).select("_id");
    userId = user?._id ?? null;
  }

  const lineItems = node.lineItems?.nodes ?? node.line_items ?? [];
  const items = [];
  for (const li of lineItems) {
    const variantId = li.variant?.id || null;
    let productKey = String(li.product?.id || li.variant?.product?.id || li.id || "shopify-item");
    if (variantId) {
      const product = await Product.findOne({
        shopifyVariantId: variantId,
      }).select("_id");
      if (product) productKey = String(product._id);
    }
    items.push({
      product: productKey,
      name: li.title || li.name || "Item",
      price: parseFloat(String(li.originalUnitPriceSet?.shopMoney?.amount || li.price || 0)),
      quantity: Number(li.quantity || 1),
      image: li.image?.url || li.variant?.image?.url || "",
    });
  }

  const totalAmount = parseFloat(
    String(
      node.totalPriceSet?.shopMoney?.amount ||
        node.currentTotalPriceSet?.shopMoney?.amount ||
        node.total_price ||
        0,
    ),
  );

  const shipping = node.shippingAddress || node.shipping_address || {};
  const fields = {
    user: userId,
    items,
    totalAmount,
    shippingAddress: {
      firstName: shipping.firstName || shipping.first_name || "",
      lastName: shipping.lastName || shipping.last_name || "",
      email,
      address: shipping.address1 || shipping.address || "",
      city: shipping.city || "",
      postcode: shipping.zip || shipping.postcode || "",
      country: shipping.country || shipping.countryCodeV2 || "",
      phone: shipping.phone || "",
    },
    status: mapShopifyOrderStatus(
      node.displayFulfillmentStatus,
      node.cancelledAt,
    ),
    paymentStatus: mapPaymentStatus(node.displayFinancialStatus),
    paymentMethod: "Shopify" as const,
    orderNumber: String(node.name || node.order_number || fromOrderId(shopifyOrderId)),
    couponCode: null,
    discountAmount: parseFloat(
      String(node.totalDiscountsSet?.shopMoney?.amount || 0),
    ),
    shopifyOrderId,
    shopifySyncedAt: new Date(),
  };

  // Order schema enum may not include Shopify — update schema
  const existing = await Order.findOne({ shopifyOrderId });
  if (existing) {
    Object.assign(existing, fields);
    await existing.save();
    return existing;
  }

  // orderNumber unique — if conflict, suffix
  const clash = await Order.findOne({ orderNumber: fields.orderNumber });
  if (clash && !clash.shopifyOrderId) {
    fields.orderNumber = `${fields.orderNumber}-S`;
  }

  return Order.create(fields);
}

function fromOrderId(gid: string) {
  return gid.split("/").pop() || "order";
}

export async function pullOrdersFromShopify(first = 50) {
  const data = await shopifyAdminRequest<{
    orders: { nodes: any[] };
  }>(
    `
    query Orders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          email
          cancelledAt
          displayFulfillmentStatus
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount } }
          customer { id email }
          shippingAddress {
            firstName lastName address1 city zip country phone countryCodeV2
          }
          lineItems(first: 50) {
            nodes {
              id
              title
              quantity
              originalUnitPriceSet { shopMoney { amount } }
              image { url }
              variant { id image { url } product { id } }
              product { id }
            }
          }
        }
      }
    }
  `,
    { first },
  );

  let pulled = 0;
  for (const node of data.orders.nodes) {
    await upsertMongoOrderFromShopify(node);
    pulled += 1;
  }
  revalidatePath("/admin/orders");
  return { pulled };
}

export async function pullAbandonedCheckouts(first = 25) {
  // Exposed for Settings; stored lightly as summary count for now
  const data = await shopifyAdminRequest<{
    abandonedCheckouts: { nodes: { id: string; name: string; createdAt: string }[] };
  }>(
    `
    query Abandoned($first: Int!) {
      abandonedCheckouts(first: $first) {
        nodes { id name createdAt }
      }
    }
  `,
    { first },
  ).catch(() => ({ abandonedCheckouts: { nodes: [] } }));

  return {
    count: data.abandonedCheckouts.nodes.length,
    checkouts: data.abandonedCheckouts.nodes,
  };
}

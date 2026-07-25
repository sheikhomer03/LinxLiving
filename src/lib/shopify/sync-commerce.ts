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
  const s = String(displayFulfillmentStatus || "").toUpperCase().trim();

  // Check UNFULFILLED before FULFILLED — "UNFULFILLED".includes("FULFILLED") is true
  if (
    !s ||
    s === "UNFULFILLED" ||
    s === "ON_HOLD" ||
    s === "OPEN" ||
    s === "PENDING_FULFILLMENT" ||
    s === "SCHEDULED"
  ) {
    return "Confirmed Order";
  }
  if (s === "IN_PROGRESS" || s === "PARTIALLY_FULFILLED" || s.includes("PARTIAL")) {
    return "Shipped";
  }
  if (s === "FULFILLED") {
    return "Delivered";
  }
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

  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const lastName = rest.join(" ");

  if (input.shopifyCustomerId) {
    const data = await shopifyAdminRequest<{
      customerUpdate: {
        customer: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(
      `
      mutation UpdateCustomer($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { message }
        }
      }
    `,
      {
        input: {
          id: input.shopifyCustomerId,
          email: input.email,
          firstName: firstName || input.email,
          lastName: lastName || undefined,
        },
      },
    );
    if (data.customerUpdate.userErrors.length) {
      throw new Error(
        data.customerUpdate.userErrors.map((e) => e.message).join("; "),
      );
    }
    return data.customerUpdate.customer?.id ?? input.shopifyCustomerId;
  }

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
    // If email already exists in Shopify, try to find and link it
    const msg = data.customerCreate.userErrors.map((e) => e.message).join("; ");
    if (/taken|already|exists/i.test(msg)) {
      const found = await shopifyAdminRequest<{
        customers: { nodes: { id: string; email: string }[] };
      }>(
        `
        query FindCustomer($q: String!) {
          customers(first: 1, query: $q) {
            nodes { id email }
          }
        }
      `,
        { q: `email:${input.email}` },
      );
      const existing = found.customers.nodes[0];
      if (existing?.id) return existing.id;
    }
    throw new Error(msg);
  }
  return data.customerCreate.customer?.id ?? null;
}

export async function pushUnsyncedCustomers(limit = 15) {
  if (!isShopifySyncEnabled()) return { pushed: 0 };
  await connectDB();
  const users = await User.find({
    role: "user",
    $or: [
      { shopifyCustomerId: null },
      { shopifyCustomerId: { $exists: false } },
      { shopifyCustomerId: "" },
    ],
  })
    .limit(limit)
    .lean();

  let pushed = 0;
  for (const user of users as any[]) {
    try {
      const id = await pushCustomerToShopify({
        name: user.name,
        email: user.email,
      });
      if (id) {
        await User.updateOne(
          { _id: user._id },
          { $set: { shopifyCustomerId: id, shopifySyncedAt: new Date() } },
        );
        pushed += 1;
      }
    } catch (error) {
      console.error("Customer catch-up sync failed:", error);
    }
  }
  return { pushed };
}

export async function pushSubscriberToShopify(email: string) {
  if (!isShopifySyncEnabled()) return null;
  const normalized = email.toLowerCase().trim();

  let customerId = await pushCustomerToShopify({
    name: normalized.split("@")[0],
    email: normalized,
  });

  if (!customerId) {
    const found = await shopifyAdminRequest<{
      customers: { nodes: { id: string }[] };
    }>(
      `
      query FindCustomer($q: String!) {
        customers(first: 1, query: $q) { nodes { id } }
      }
    `,
      { q: `email:${normalized}` },
    );
    customerId = found.customers.nodes[0]?.id ?? null;
  }

  if (!customerId) return null;

  const consent = await shopifyAdminRequest<{
    customerEmailMarketingConsentUpdate: {
      userErrors: { message: string }[];
      customer: { id: string } | null;
    };
  }>(
    `
    mutation Subscribe($input: CustomerEmailMarketingConsentUpdateInput!) {
      customerEmailMarketingConsentUpdate(input: $input) {
        customer { id }
        userErrors { message }
      }
    }
  `,
    {
      input: {
        customerId,
        emailMarketingConsent: {
          marketingState: "SUBSCRIBED",
          marketingOptInLevel: "SINGLE_OPT_IN",
        },
      },
    },
  );

  if (consent.customerEmailMarketingConsentUpdate.userErrors.length) {
    const msg = consent.customerEmailMarketingConsentUpdate.userErrors
      .map((e) => e.message)
      .join("; ");
    if (!/already/i.test(msg)) throw new Error(msg);
  }

  return customerId;
}

export async function pushAddressToShopify(input: {
  shopifyCustomerId: string;
  shopifyAddressId?: string | null;
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  county?: string;
  postcode: string;
  country: string;
  phone?: string;
}) {
  if (!isShopifySyncEnabled()) return null;

  const address = {
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company || undefined,
    address1: input.address1,
    address2: input.address2 || undefined,
    city: input.city,
    province: input.county || undefined,
    zip: input.postcode,
    country: input.country || "GB",
    phone: input.phone || undefined,
  };

  if (input.shopifyAddressId) {
    const data = await shopifyAdminRequest<{
      customerAddressUpdate: {
        customerAddress: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(
      `
      mutation UpdateAddr($customerId: ID!, $addressId: ID!, $address: MailingAddressInput!) {
        customerAddressUpdate(customerId: $customerId, addressId: $addressId, address: $address) {
          customerAddress { id }
          userErrors { message }
        }
      }
    `,
      {
        customerId: input.shopifyCustomerId,
        addressId: input.shopifyAddressId,
        address,
      },
    );
    if (data.customerAddressUpdate.userErrors.length) {
      throw new Error(
        data.customerAddressUpdate.userErrors.map((e) => e.message).join("; "),
      );
    }
    return (
      data.customerAddressUpdate.customerAddress?.id ?? input.shopifyAddressId
    );
  }

  const data = await shopifyAdminRequest<{
    customerAddressCreate: {
      customerAddress: { id: string } | null;
      userErrors: { message: string }[];
    };
  }>(
    `
    mutation CreateAddr($customerId: ID!, $address: MailingAddressInput!) {
      customerAddressCreate(customerId: $customerId, address: $address) {
        customerAddress { id }
        userErrors { message }
      }
    }
  `,
    { customerId: input.shopifyCustomerId, address },
  );

  if (data.customerAddressCreate.userErrors.length) {
    throw new Error(
      data.customerAddressCreate.userErrors.map((e) => e.message).join("; "),
    );
  }
  return data.customerAddressCreate.customerAddress?.id ?? null;
}

export async function deleteShopifyAddress(
  shopifyCustomerId: string,
  shopifyAddressId: string,
) {
  if (!isShopifySyncEnabled()) return;
  await shopifyAdminRequest(
    `
    mutation DeleteAddr($customerId: ID!, $addressId: ID!) {
      customerAddressDelete(customerId: $customerId, addressId: $addressId) {
        deletedAddressId
        userErrors { message }
      }
    }
  `,
    { customerId: shopifyCustomerId, addressId: shopifyAddressId },
  );
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

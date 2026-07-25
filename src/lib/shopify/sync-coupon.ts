import { shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import connectDB from "@/lib/mongodb";
import { Coupon } from "@/models/Coupon";
import { revalidatePath } from "next/cache";
import { toShopifyGid } from "./helpers";

type CouponInput = {
  code: string;
  discountType: "percentage" | "fixed";
  discountAmount: number;
  minOrderAmount?: number;
  startDate?: Date | string | null;
  expiryDate: Date | string;
  usageLimit?: number | null;
  isActive?: boolean;
  shopifyDiscountId?: string | null;
};

function buildBasicCodeDiscountInput(input: CouponInput) {
  const startsAt = input.startDate
    ? new Date(input.startDate).toISOString()
    : new Date().toISOString();
  const endsAt = new Date(input.expiryDate).toISOString();

  const customerGetsValue =
    input.discountType === "percentage"
      ? { percentage: Math.min(100, Math.max(0, input.discountAmount)) / 100 }
      : {
          discountAmount: {
            amount: String(input.discountAmount),
            appliesOnEachItem: false,
          },
        };

  return {
    title: input.code,
    code: input.code,
    startsAt,
    endsAt,
    usageLimit: input.usageLimit ?? null,
    customerSelection: { all: true },
    customerGets: {
      value: customerGetsValue,
      items: { all: true },
    },
    minimumRequirement:
      input.minOrderAmount && input.minOrderAmount > 0
        ? {
            subtotal: {
              greaterThanOrEqualToSubtotal: String(input.minOrderAmount),
            },
          }
        : null,
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: true,
      shippingDiscounts: true,
    },
  };
}

async function setDiscountActiveState(
  shopifyDiscountId: string,
  isActive: boolean,
) {
  const mutation = isActive
    ? `
      mutation Activate($id: ID!) {
        discountCodeActivate(id: $id) {
          codeDiscountNode { id }
          userErrors { message }
        }
      }
    `
    : `
      mutation Deactivate($id: ID!) {
        discountCodeDeactivate(id: $id) {
          codeDiscountNode { id }
          userErrors { message }
        }
      }
    `;

  const key = isActive ? "discountCodeActivate" : "discountCodeDeactivate";
  const data = await shopifyAdminRequest<Record<string, any>>(mutation, {
    id: shopifyDiscountId,
  });
  const errors = data[key]?.userErrors || [];
  if (errors.length) {
    // Ignore "already active/inactive" style failures
    const msg = errors.map((e: any) => e.message).join("; ");
    if (!/already/i.test(msg)) {
      throw new Error(msg);
    }
  }
}

export async function pushCouponToShopify(input: CouponInput) {
  if (!isShopifySyncEnabled()) return null;

  const basicCodeDiscount = buildBasicCodeDiscountInput(input);

  if (input.shopifyDiscountId) {
    const data = await shopifyAdminRequest<{
      discountCodeBasicUpdate: {
        codeDiscountNode: { id: string } | null;
        userErrors: { message: string; field?: string[] }[];
      };
    }>(
      `
      mutation UpdateDiscount($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode { id }
          userErrors { field message }
        }
      }
    `,
      {
        id: input.shopifyDiscountId,
        basicCodeDiscount,
      },
    );

    if (data.discountCodeBasicUpdate.userErrors.length) {
      throw new Error(
        data.discountCodeBasicUpdate.userErrors
          .map((e) => e.message)
          .join("; "),
      );
    }

    const id =
      data.discountCodeBasicUpdate.codeDiscountNode?.id ??
      input.shopifyDiscountId;

    if (typeof input.isActive === "boolean") {
      await setDiscountActiveState(id, input.isActive);
    }

    return id;
  }

  const data = await shopifyAdminRequest<{
    discountCodeBasicCreate: {
      codeDiscountNode: { id: string } | null;
      userErrors: { message: string; field?: string[] }[];
    };
  }>(
    `
    mutation CreateDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `,
    { basicCodeDiscount },
  );

  if (data.discountCodeBasicCreate.userErrors.length) {
    throw new Error(
      data.discountCodeBasicCreate.userErrors.map((e) => e.message).join("; "),
    );
  }

  const id = data.discountCodeBasicCreate.codeDiscountNode?.id ?? null;
  if (id && input.isActive === false) {
    await setDiscountActiveState(id, false);
  }
  return id;
}

export async function deleteShopifyCoupon(shopifyDiscountId: string) {
  if (!isShopifySyncEnabled()) return;
  const data = await shopifyAdminRequest<{
    discountCodeDelete: {
      deletedCodeDiscountId: string | null;
      userErrors: { message: string }[];
    };
  }>(
    `
    mutation DeleteDiscount($id: ID!) {
      discountCodeDelete(id: $id) {
        deletedCodeDiscountId
        userErrors { message }
      }
    }
  `,
    { id: shopifyDiscountId },
  );

  if (data.discountCodeDelete.userErrors.length) {
    throw new Error(
      data.discountCodeDelete.userErrors.map((e) => e.message).join("; "),
    );
  }
}

export async function deleteMongoCouponByShopifyId(
  shopifyId: string | number,
) {
  await connectDB();
  const gid = String(shopifyId).startsWith("gid://")
    ? String(shopifyId)
    : toShopifyGid("DiscountCodeNode", shopifyId);

  const deleted = await Coupon.findOneAndDelete({
    $or: [{ shopifyDiscountId: gid }, { shopifyDiscountId: String(shopifyId) }],
  });
  if (deleted) {
    revalidatePath("/admin/coupons");
  }
  return { deleted: Boolean(deleted) };
}

function mapDiscountNode(node: any) {
  const d = node.codeDiscount;
  if (!d) return null;

  const codeFromList = d.codes?.nodes?.[0]?.code;
  const code = String(codeFromList || d.title || "")
    .toUpperCase()
    .trim();
  if (!code) return null;

  const percentage = d.customerGets?.value?.percentage;
  const fixed = d.customerGets?.value?.amount?.amount;
  if (percentage == null && fixed == null) return null;

  const status = String(d.status || "").toUpperCase();
  const isActive = status === "ACTIVE" || status === "SCHEDULED";

  return {
    code,
    discountType: (percentage != null ? "percentage" : "fixed") as
      | "percentage"
      | "fixed",
    discountAmount:
      percentage != null
        ? Math.round(Number(percentage) * 10000) / 100
        : parseFloat(String(fixed || 0)),
    minOrderAmount: parseFloat(
      String(d.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount || 0),
    ),
    startDate: d.startsAt ? new Date(d.startsAt) : new Date(),
    expiryDate: d.endsAt
      ? new Date(d.endsAt)
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    usageLimit: d.usageLimit ?? null,
    usedCount: d.asyncUsageCount ?? 0,
    isActive,
    shopifyDiscountId: node.id,
    shopifySyncedAt: new Date(),
    shopifySyncError: null as string | null,
  };
}

export async function pullDiscountsFromShopify(first = 50) {
  const data = await shopifyAdminRequest<{
    codeDiscountNodes: { nodes: any[] };
  }>(
    `
    query Discounts($first: Int!) {
      codeDiscountNodes(first: $first, reverse: true) {
        nodes {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              status
              startsAt
              endsAt
              usageLimit
              asyncUsageCount
              codes(first: 5) { nodes { code } }
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount { amount { amount } }
                }
              }
              minimumRequirement {
                ... on DiscountMinimumSubtotal {
                  greaterThanOrEqualToSubtotal { amount }
                }
              }
            }
            ... on DiscountCodeFreeShipping {
              title
              status
              startsAt
              endsAt
              codes(first: 5) { nodes { code } }
            }
            ... on DiscountCodeBxgy {
              title
              status
              startsAt
              endsAt
              codes(first: 5) { nodes { code } }
            }
          }
        }
      }
    }
  `,
    { first },
  );

  await connectDB();
  let pulled = 0;
  const codes: string[] = [];

  for (const node of data.codeDiscountNodes.nodes) {
    const d = node.codeDiscount;
    if (!d) continue;

    let fields = mapDiscountNode(node);
    if (!fields) {
      const code = String(d.codes?.nodes?.[0]?.code || d.title || "")
        .toUpperCase()
        .trim();
      if (!code) continue;
      const status = String(d.status || "").toUpperCase();
      fields = {
        code,
        discountType: "percentage",
        discountAmount: 0,
        minOrderAmount: 0,
        startDate: d.startsAt ? new Date(d.startsAt) : new Date(),
        expiryDate: d.endsAt
          ? new Date(d.endsAt)
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        usageLimit: null,
        usedCount: 0,
        isActive: status === "ACTIVE" || status === "SCHEDULED",
        shopifyDiscountId: node.id,
        shopifySyncedAt: new Date(),
        shopifySyncError: null,
      };
    }

    const existing = await Coupon.findOne({
      $or: [{ shopifyDiscountId: node.id }, { code: fields.code }],
    });
    if (existing) {
      Object.assign(existing, fields);
      await existing.save();
    } else {
      await Coupon.create(fields);
    }
    pulled += 1;
    codes.push(fields.code);
  }

  revalidatePath("/admin/coupons");
  return { pulled, codes };
}

/**
 * Push local coupons that never got a Shopify discount ID.
 */
export async function pushUnsyncedCoupons(limit = 15) {
  if (!isShopifySyncEnabled()) return { pushed: 0 };

  await connectDB();
  const unsynced = await Coupon.find({
    $or: [
      { shopifyDiscountId: null },
      { shopifyDiscountId: { $exists: false } },
      { shopifyDiscountId: "" },
    ],
  })
    .limit(limit)
    .lean();

  let pushed = 0;
  for (const coupon of unsynced as any[]) {
    try {
      const shopifyId = await pushCouponToShopify({
        code: coupon.code,
        discountType: coupon.discountType,
        discountAmount: coupon.discountAmount,
        minOrderAmount: coupon.minOrderAmount,
        startDate: coupon.startDate,
        expiryDate: coupon.expiryDate,
        usageLimit: coupon.usageLimit,
        isActive: coupon.isActive,
      });
      if (shopifyId) {
        await Coupon.updateOne(
          { _id: coupon._id },
          {
            $set: {
              shopifyDiscountId: shopifyId,
              shopifySyncedAt: new Date(),
              shopifySyncError: null,
            },
          },
        );
        pushed += 1;
      }
    } catch (error) {
      await Coupon.updateOne(
        { _id: coupon._id },
        {
          $set: {
            shopifySyncError:
              error instanceof Error ? error.message : "Coupon sync failed",
          },
        },
      );
    }
  }

  return { pushed };
}

import { shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import connectDB from "@/lib/mongodb";
import { Coupon } from "@/models/Coupon";
import { revalidatePath } from "next/cache";

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

export async function pushCouponToShopify(input: CouponInput) {
  if (!isShopifySyncEnabled()) return null;

  if (input.shopifyDiscountId) {
    return input.shopifyDiscountId;
  }

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
    {
      basicCodeDiscount: {
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
      },
    },
  );

  if (data.discountCodeBasicCreate.userErrors.length) {
    throw new Error(
      data.discountCodeBasicCreate.userErrors.map((e) => e.message).join("; "),
    );
  }
  return data.discountCodeBasicCreate.codeDiscountNode?.id ?? null;
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
    // Free shipping / BXGY: store as 0% placeholder so they still appear
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

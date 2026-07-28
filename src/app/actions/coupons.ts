"use server";

import connectDB from "@/lib/mongodb";
import { Coupon } from "@/models/Coupon";
import { revalidatePath } from "next/cache";

export async function getCoupons() {
  try {
    await connectDB();
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    return JSON.parse(JSON.stringify(coupons));
  } catch (error) {
    console.error("Failed to fetch coupons:", error);
    return [];
  }
}

export async function getCoupon(id: string) {
  try {
    await connectDB();
    const coupon = await Coupon.findById(id);
    if (!coupon) return null;
    return JSON.parse(JSON.stringify(coupon));
  } catch (error) {
    console.error("Failed to fetch coupon:", error);
    return null;
  }
}

export async function createCoupon(data: any) {
  try {
    if (data.discountAmount <= 0) {
      return {
        success: false,
        error: "Discount amount must be greater than 0",
      };
    }
    if (data.discountType === "percentage" && data.discountAmount > 100) {
      return {
        success: false,
        error: "Percentage discount cannot exceed 100%",
      };
    }

    await connectDB();
    const coupon = await Coupon.create(data);

    if (process.env.SHOPIFY_SYNC_ENABLED !== "false") {
      try {
        const { isShopifySyncEnabled } = await import("@/lib/shopify");
        if (isShopifySyncEnabled()) {
          const { pushCouponToShopify } = await import(
            "@/lib/shopify/sync-coupon"
          );
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
            coupon.shopifyDiscountId = shopifyId;
            coupon.shopifySyncedAt = new Date();
            await coupon.save();
          }
        }
      } catch (error) {
        console.error("Shopify coupon sync failed:", error);
        coupon.shopifySyncError =
          error instanceof Error ? error.message : "Coupon sync failed";
        await coupon.save();
      }
    }

    revalidatePath("/admin/coupons");
    return { success: true, coupon: JSON.parse(JSON.stringify(coupon)) };
  } catch (error: any) {
    console.error("Failed to create coupon:", error);
    return {
      success: false,
      error: error.message || "Failed to create coupon",
    };
  }
}

export async function updateCoupon(id: string, data: any) {
  try {
    if (data.discountAmount <= 0) {
      return {
        success: false,
        error: "Discount amount must be greater than 0",
      };
    }
    if (data.discountType === "percentage" && data.discountAmount > 100) {
      return {
        success: false,
        error: "Percentage discount cannot exceed 100%",
      };
    }

    await connectDB();
    const coupon = await Coupon.findByIdAndUpdate(id, data, { new: true });
    if (!coupon) {
      return { success: false, error: "Coupon not found" };
    }

    if (process.env.SHOPIFY_SYNC_ENABLED !== "false") {
      try {
        const { isShopifySyncEnabled } = await import("@/lib/shopify");
        if (isShopifySyncEnabled()) {
          const { pushCouponToShopify } = await import(
            "@/lib/shopify/sync-coupon"
          );
          const shopifyId = await pushCouponToShopify({
            code: coupon.code,
            discountType: coupon.discountType,
            discountAmount: coupon.discountAmount,
            minOrderAmount: coupon.minOrderAmount,
            startDate: coupon.startDate,
            expiryDate: coupon.expiryDate,
            usageLimit: coupon.usageLimit,
            isActive: coupon.isActive,
            shopifyDiscountId: coupon.shopifyDiscountId,
          });
          if (shopifyId) {
            coupon.shopifyDiscountId = shopifyId;
            coupon.shopifySyncedAt = new Date();
            coupon.shopifySyncError = null;
            await coupon.save();
          }
        }
      } catch (error) {
        console.error("Shopify coupon update sync failed:", error);
        coupon.shopifySyncError =
          error instanceof Error ? error.message : "Coupon sync failed";
        await coupon.save();
      }
    }

    revalidatePath("/admin/coupons");
    return { success: true, coupon: JSON.parse(JSON.stringify(coupon)) };
  } catch (error: any) {
    console.error("Failed to update coupon:", error);
    return {
      success: false,
      error: error.message || "Failed to update coupon",
    };
  }
}

export async function deleteCoupon(id: string) {
  try {
    await connectDB();
    const existing = await Coupon.findById(id).select("shopifyDiscountId");
    if (existing?.shopifyDiscountId && process.env.SHOPIFY_SYNC_ENABLED !== "false") {
      try {
        const { isShopifySyncEnabled } = await import("@/lib/shopify");
        if (isShopifySyncEnabled()) {
          const { deleteShopifyCoupon } = await import(
            "@/lib/shopify/sync-coupon"
          );
          await deleteShopifyCoupon(existing.shopifyDiscountId);
        }
      } catch (error) {
        console.error("Shopify coupon delete sync failed:", error);
      }
    }

    await Coupon.findByIdAndDelete(id);
    revalidatePath("/admin/coupons");
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete coupon:", error);
    return {
      success: false,
      error: error.message || "Failed to delete coupon",
    };
  }
}
export async function validateCoupon(code: string, subtotal: number) {
  try {
    await connectDB();
    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
    });

    if (!coupon) {
      return { success: false, error: "Invalid or inactive coupon code" };
    }

    const now = new Date();
    if (now < new Date(coupon.startDate)) {
      return { success: false, error: "This coupon is not yet active" };
    }

    if (now > new Date(coupon.expiryDate)) {
      return { success: false, error: "This coupon has expired" };
    }

    if (subtotal < coupon.minOrderAmount) {
      return {
        success: false,
        error: `Minimum order amount for this coupon is £${coupon.minOrderAmount}`,
      };
    }

    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return {
        success: false,
        error: "This coupon has reached its usage limit",
      };
    }

    return {
      success: true,
      coupon: JSON.parse(JSON.stringify(coupon)),
    };
  } catch (error: any) {
    console.error("Failed to validate coupon:", error);
    return { success: false, error: "Internal server error" };
  }
}

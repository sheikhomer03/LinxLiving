"use server";

import connectDB from "@/lib/mongodb";
import { Review } from "@/models/Review";
import { Product } from "@/models/Product";
import { Order } from "@/models/Order";
import {
  MAX_REVIEW_PHOTOS,
  REVIEW_PHOTO_RX,
  REVIEWABLE_ORDER_STATUSES,
} from "@/lib/reviewRules";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import mongoose from "mongoose";

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    throw new Error("Unauthorized");
  }
  return session;
}

/**
 * The order through which this customer bought this product, or null.
 *
 * `Order.items[].product` is a string, so the id is compared as a string
 * rather than an ObjectId.
 */
export async function findPurchaseOrder(userId: string, productId: string) {
  if (!userId || !productId) return null;
  await connectDB();
  const order = await Order.findOne({
    user: userId,
    status: { $in: REVIEWABLE_ORDER_STATUSES },
    paymentStatus: "Paid",
    "items.product": String(productId),
  })
    .select("_id orderNumber createdAt")
    .sort({ createdAt: -1 })
    .lean();
  return (order as any) || null;
}

/**
 * Whether the signed-in customer may review this product, and why not if not.
 *
 * Called by the product page so the form can explain itself rather than
 * failing on submit.
 */
export async function getReviewEligibility(productId: string) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return { canReview: false, reason: "signed-out" as const };
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return { canReview: false, reason: "invalid" as const };
    }

    await connectDB();
    const existing = await Review.findOne({
      product: productId,
      user: userId,
    })
      .select("_id status")
      .lean();
    if (existing) {
      return {
        canReview: false,
        reason: "already-reviewed" as const,
        status: (existing as any).status as string,
      };
    }

    const order = await findPurchaseOrder(userId, productId);
    if (!order) {
      return { canReview: false, reason: "not-purchased" as const };
    }

    return {
      canReview: true,
      reason: "ok" as const,
      orderNumber: String(order.orderNumber || ""),
    };
  } catch (error) {
    console.error("Review eligibility error:", error);
    return { canReview: false, reason: "error" as const };
  }
}

/** Batch review averages for catalogue cards. */
export async function getApprovedReviewSummaries(productIds: string[]) {
  try {
    const ids = [
      ...new Set(
        (productIds || [])
          .map((id) => String(id || "").trim())
          .filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ].slice(0, 48);
    if (!ids.length) return {} as Record<string, { average: number; count: number }>;

    await connectDB();
    const rows = await Review.aggregate<{
      _id: mongoose.Types.ObjectId;
      average: number;
      count: number;
    }>([
      {
        $match: {
          product: {
            $in: ids.map((id) => new mongoose.Types.ObjectId(id)),
          },
          status: "approved",
        },
      },
      {
        $group: {
          _id: "$product",
          average: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]);

    const out: Record<string, { average: number; count: number }> = {};
    for (const row of rows) {
      out[String(row._id)] = {
        average: Math.round(Number(row.average || 0) * 10) / 10,
        count: Number(row.count || 0),
      };
    }
    // Plain JSON for server-action / Flight serialization safety
    return serialize(out);
  } catch (error) {
    console.error("Failed to fetch review summaries:", error);
    return {} as Record<string, { average: number; count: number }>;
  }
}

/** Approved reviews for a product (storefront). */
export async function getApprovedProductReviews(productId: string) {
  try {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return { reviews: [], average: 0, count: 0 };
    }
    await connectDB();
    // Explicit field list: these go to the browser, and the document also
    // holds the reviewer's email address.
    const reviews = await Review.find({
      product: productId,
      status: "approved",
    })
      .select("name rating title comment photos order createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const count = reviews.length;
    const average =
      count > 0
        ? reviews.reduce((sum, r: any) => sum + Number(r.rating || 0), 0) /
          count
        : 0;

    const publicReviews = (reviews as any[]).map(({ order, ...r }) => ({
      ...r,
      verifiedPurchase: Boolean(order),
    }));

    return {
      reviews: serialize(publicReviews),
      average: Math.round(average * 10) / 10,
      count,
    };
  } catch (error) {
    console.error("Failed to fetch product reviews:", error);
    return { reviews: [], average: 0, count: 0 };
  }
}

/** Public submit — requires sign-in; always starts as pending until admin approves. */
export async function submitProductReview(input: {
  productId: string;
  name: string;
  email: string;
  rating: number;
  title?: string;
  comment: string;
  photos?: string[];
}) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { success: false, error: "Please sign in to submit a review" };
    }

    const name = String(
      input.name || session.user.name || "Customer",
    ).trim();
    const email = String(session.user.email).trim().toLowerCase();
    const comment = String(input.comment || "").trim();
    const title = String(input.title || "").trim();
    const rating = Number(input.rating);
    const productId = String(input.productId || "");

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return { success: false, error: "Invalid product" };
    }
    if (!comment) {
      return { success: false, error: "Please write a review" };
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return { success: false, error: "Please choose a rating from 1 to 5" };
    }

    await connectDB();
    const product = await Product.findById(productId).select("_id name").lean();
    if (!product) {
      return { success: false, error: "Product not found" };
    }

    const userId = (session.user as { id?: string }).id || null;
    if (!userId) {
      return { success: false, error: "Please sign in to submit a review" };
    }

    // Reviews are for customers who bought the product. Checked here as well
    // as in the UI — the eligibility call is a convenience, not the gate.
    const order = await findPurchaseOrder(userId, productId);
    if (!order) {
      return {
        success: false,
        error:
          "Only customers who have received this product can review it.",
      };
    }

    const existing = await Review.findOne({ product: productId, user: userId })
      .select("_id")
      .lean();
    if (existing) {
      return {
        success: false,
        error: "You have already reviewed this product.",
      };
    }

    // Only ever trust our own Cloudinary URLs — the field arrives from the
    // browser, so an arbitrary link would otherwise be embedded on the page.
    const photos = (Array.isArray(input.photos) ? input.photos : [])
      .map((url) => String(url || "").trim())
      .filter((url) => REVIEW_PHOTO_RX.test(url))
      .slice(0, MAX_REVIEW_PHOTOS);

    await Review.create({
      product: productId,
      user: userId,
      order: order._id,
      name,
      email,
      rating,
      title,
      comment,
      photos,
      status: "pending",
    });

    revalidatePath("/admin/reviews");
    return {
      success: true,
      message:
        "Thank you — your review was submitted and will appear after approval.",
    };
  } catch (error) {
    console.error("Submit review error:", error);
    return {
      success: false,
      error: "Failed to submit review. Please try again.",
    };
  }
}

export async function getAdminReviews(opts?: {
  page?: number;
  limit?: number;
  status?: string;
}) {
  try {
    await requireAdmin();
    await connectDB();
    const page = opts?.page || 1;
    const limit = opts?.limit || 20;
    const skip = (page - 1) * limit;
    const filter: Record<string, string> = {};
    if (
      opts?.status &&
      ["pending", "approved", "rejected"].includes(opts.status)
    ) {
      filter.status = opts.status;
    }

    const [reviews, totalCount] = await Promise.all([
      Review.find(filter)
        .populate("product", "name images category")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);

    return {
      reviews: serialize(reviews),
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1,
    };
  } catch (error) {
    console.error("Failed to fetch admin reviews:", error);
    return { reviews: [], totalCount: 0, page: 1, totalPages: 1 };
  }
}

export async function getAdminReview(id: string) {
  try {
    await requireAdmin();
    await connectDB();
    const review = await Review.findById(id)
      .populate("product", "name images category price")
      .lean();
    if (!review) return null;
    return serialize(review);
  } catch (error) {
    console.error("Failed to fetch review:", error);
    return null;
  }
}

export async function updateReviewStatus(
  id: string,
  status: "pending" | "approved" | "rejected",
) {
  try {
    await requireAdmin();
    if (!["pending", "approved", "rejected"].includes(status)) {
      return { success: false, error: "Invalid status" };
    }
    await connectDB();
    const review = await Review.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    );
    if (!review) return { success: false, error: "Review not found" };

    revalidatePath("/admin/reviews");
    revalidatePath(`/admin/reviews/${id}`);
    if (review.product) {
      revalidatePath(`/products/${review.product.toString()}`);
    }
    return { success: true };
  } catch (error) {
    console.error("Failed to update review status:", error);
    return { success: false, error: "Update failed" };
  }
}

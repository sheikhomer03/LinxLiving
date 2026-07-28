"use server";

import connectDB from "@/lib/mongodb";
import { Review } from "@/models/Review";
import { Product } from "@/models/Product";
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

/** Approved reviews for a product (storefront). */
export async function getApprovedProductReviews(productId: string) {
  try {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return { reviews: [], average: 0, count: 0 };
    }
    await connectDB();
    const reviews = await Review.find({
      product: productId,
      status: "approved",
    })
      .sort({ createdAt: -1 })
      .lean();

    const count = reviews.length;
    const average =
      count > 0
        ? reviews.reduce((sum, r: any) => sum + Number(r.rating || 0), 0) /
          count
        : 0;

    return {
      reviews: serialize(reviews),
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

    await Review.create({
      product: productId,
      user: (session.user as { id?: string }).id || null,
      name,
      email,
      rating,
      title,
      comment,
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

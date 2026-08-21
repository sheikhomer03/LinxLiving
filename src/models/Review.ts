import mongoose from "mongoose";

const ReviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: [true, "Please provide your email"],
      trim: true,
      lowercase: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    comment: {
      type: String,
      required: [true, "Please write a review"],
      trim: true,
      maxlength: 2000,
    },
    /**
     * Photos the customer took of the delivered product.
     *
     * Cloudinary URLs, uploaded through /api/reviews/upload. Held with the
     * review until an admin approves it — customer images are published on the
     * storefront, so nothing goes live unreviewed.
     */
    photos: {
      type: [String],
      default: [],
    },
    /** The order this review was earned through. */
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true },
);

ReviewSchema.index({ product: 1, status: 1, createdAt: -1 });

/**
 * One review per customer per product. Partial so the legacy rows written
 * before reviews required an account (user: null) do not collide.
 */
ReviewSchema.index(
  { product: 1, user: 1 },
  { unique: true, partialFilterExpression: { user: { $type: "objectId" } } },
);

export const Review =
  mongoose.models.Review || mongoose.model("Review", ReviewSchema);

import mongoose from "mongoose";

const BrandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide a brand name"],
      trim: true,
      maxlength: [100, "Name cannot be more than 100 characters"],
    },
    slug: {
      type: String,
      required: [true, "Please provide a slug"],
      trim: true,
      lowercase: true,
      unique: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    image: {
      type: String,
      default: "",
      trim: true,
    },
    shopifyCollectionId: { type: String, default: null, index: true },
    shopifySyncError: { type: String, default: null },
    shopifySyncedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

if (mongoose.models.Brand && !mongoose.models.Brand.schema.path("image")) {
  mongoose.models.Brand.schema.add({
    image: { type: String, default: "", trim: true },
  });
}

export const Brand =
  (mongoose.models.Brand as mongoose.Model<any>) ||
  mongoose.model("Brand", BrandSchema);

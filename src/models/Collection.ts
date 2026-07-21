import mongoose from "mongoose";

const CollectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide a collection name"],
      trim: true,
      maxlength: [120, "Name cannot be more than 120 characters"],
    },
    slug: {
      type: String,
      required: [true, "Please provide a slug"],
      trim: true,
      lowercase: true,
      unique: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    image: {
      type: String,
      default: "",
      trim: true,
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

if (mongoose.models.Collection && !mongoose.models.Collection.schema.path("image")) {
  mongoose.models.Collection.schema.add({
    image: { type: String, default: "", trim: true },
  });
}

export const Collection =
  (mongoose.models.Collection as mongoose.Model<any>) ||
  mongoose.model("Collection", CollectionSchema);

import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    images: [{ type: String }],
    category: { type: String, required: true },
    stock: { type: Number, required: true, default: 0 },
    tagline: { type: String },
    schematicImage: { type: String },
    specs: {
      material: String,
      finish: String,
      size: String,
      slipRating: String,
      variation: String,
      suitability: String,
      rectifiedEdge: String,
      thickness: String,
    },
  },
  { timestamps: true },
);

export const Product =
  mongoose.models.Product || mongoose.model("Product", ProductSchema);

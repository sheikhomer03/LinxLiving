import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    images: [{ type: String }],
    category: { type: String, required: true },
    subCategory: { type: String },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
    stock: { type: Number, required: true, default: 0 },
    tagline: { type: String },
    schematicImage: { type: String },
    specs: { type: mongoose.Schema.Types.Mixed, default: {} },
    showSpecs: { type: Boolean, default: true },
    /** Shopify Admin GraphQL product GID (gid://shopify/Product/...) */
    shopifyProductId: { type: String, default: null, index: true },
    /** Shopify variant GID used for price/inventory/cart */
    shopifyVariantId: { type: String, default: null },
    /** Last Shopify sync error (null when healthy) */
    shopifySyncError: { type: String, default: null },
    shopifySyncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ProductSchema.index({ category: 1, createdAt: -1 });
ProductSchema.index({ subCategory: 1, createdAt: -1 });
ProductSchema.index({ brand: 1, createdAt: -1 });
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ name: "text", description: "text" });

// Hot reload can keep an older compiled model without newer fields.
if (mongoose.models.Product && !mongoose.models.Product.schema.path("brand")) {
  mongoose.models.Product.schema.add({
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("shopifyProductId")
) {
  mongoose.models.Product.schema.add({
    shopifyProductId: { type: String, default: null, index: true },
    shopifyVariantId: { type: String, default: null },
    shopifySyncError: { type: String, default: null },
    shopifySyncedAt: { type: Date, default: null },
  });
}

export const Product =
  mongoose.models.Product || mongoose.model("Product", ProductSchema);

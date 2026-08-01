import mongoose from "mongoose";

const OptionExtraSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    imageUrl: { type: String, default: "" },
    priceAdjustment: { type: Number, default: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const FlashingFinderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
  },
  { _id: false },
);

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    images: [{ type: String }],
    /** Empty = not ready for storefront / Shopify stays Draft */
    category: { type: String, default: "", trim: true },
    subCategory: { type: String },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
    /** Override brand default supplier when set */
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
    },
    /** Our internal SKU (LINX Product ID) — falls back to specs.sku when empty */
    linxSku: { type: String, default: "", trim: true, index: true },
    supplierSku: { type: String, default: "", trim: true },
    manufacturerSku: { type: String, default: "", trim: true },
    /** Ex-VAT cost from supplier */
    costPrice: { type: Number, default: null },
    importCost: { type: Number, default: null },
    deliveryCost: { type: Number, default: null },
    dutyCost: { type: Number, default: null },
    packagingCost: { type: Number, default: null },
    handlingCost: { type: Number, default: null },
    overheadCost: { type: Number, default: null },
    /** Margin % applied on landed cost to set sell price (ex VAT) */
    marginPercent: { type: Number, default: null },
    /** VAT rate % — UK standard 20 */
    vatRate: { type: Number, default: 20 },
    leadTimeDays: { type: Number, default: null },
    warranty: { type: String, default: "", trim: true },
    complianceCertificates: { type: [String], default: [] },
    stock: { type: Number, required: true, default: 0 },
    stockSyncedAt: { type: Date, default: null },
    priceSyncedAt: { type: Date, default: null },
    /** Out-of-stock flag for sync jobs */
    isOutOfStock: { type: Boolean, default: false },
    tagline: { type: String },
    schematicImage: { type: String },
    specs: { type: mongoose.Schema.Types.Mixed, default: {} },
    showSpecs: { type: Boolean, default: true },

    /** Linx Glass–style optional content / add-ons */
    installationGuide: { type: String, default: null },
    /** null = not offered on PDP */
    insulatingSetPrice: { type: Number, default: null },
    flashingFinder: { type: [FlashingFinderSchema], default: [] },
    finishes: { type: [OptionExtraSchema], default: [] },
    flashings: { type: [OptionExtraSchema], default: [] },

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
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("installationGuide")
) {
  mongoose.models.Product.schema.add({
    installationGuide: { type: String, default: null },
    insulatingSetPrice: { type: Number, default: null },
    flashingFinder: { type: [FlashingFinderSchema], default: [] },
    finishes: { type: [OptionExtraSchema], default: [] },
    flashings: { type: [OptionExtraSchema], default: [] },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("supplier")) {
  mongoose.models.Product.schema.add({
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
    },
    supplierSku: { type: String, default: "", trim: true },
    costPrice: { type: Number, default: null },
    marginPercent: { type: Number, default: null },
    leadTimeDays: { type: Number, default: null },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("linxSku")) {
  mongoose.models.Product.schema.add({
    linxSku: { type: String, default: "", trim: true, index: true },
    manufacturerSku: { type: String, default: "", trim: true },
    importCost: { type: Number, default: null },
    deliveryCost: { type: Number, default: null },
    dutyCost: { type: Number, default: null },
    packagingCost: { type: Number, default: null },
    handlingCost: { type: Number, default: null },
    overheadCost: { type: Number, default: null },
    vatRate: { type: Number, default: 20 },
    warranty: { type: String, default: "", trim: true },
    complianceCertificates: { type: [String], default: [] },
    stockSyncedAt: { type: Date, default: null },
    priceSyncedAt: { type: Date, default: null },
    isOutOfStock: { type: Boolean, default: false },
  });
}

export const Product =
  mongoose.models.Product || mongoose.model("Product", ProductSchema);

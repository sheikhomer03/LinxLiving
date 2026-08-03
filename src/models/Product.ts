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

const ProductVariantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: "", trim: true },
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
    price: { type: Number, default: null },
    tradePrice: { type: Number, default: null },
    stock: { type: Number, default: null },
    imageUrl: { type: String, default: "" },
    barcode: { type: String, default: "", trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const ProductDownloadSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["pdf", "drawing", "install", "certificate", "other"],
      default: "pdf",
    },
  },
  { _id: false },
);

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    /** Trade / account price (ex VAT) when applicable */
    tradePrice: { type: Number, default: null },
    images: [{ type: String }],
    videos: [{ type: String }],

    /**
     * LINX taxonomy:
     * Department → Category → Subcategory → Product (+ variants)
     * Brand is independent and may be multi-valued.
     */
    department: { type: String, default: "", trim: true, index: true },
    /** Empty = not ready for storefront / Shopify stays Draft */
    category: { type: String, default: "", trim: true },
    subCategory: { type: String },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
    /** Additional brands this product appears under (Shop by Brand) */
    brands: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Brand" }],
      default: [],
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
    productCode: { type: String, default: "", trim: true, index: true },
    barcode: { type: String, default: "", trim: true },

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
    deliveryEstimateDays: { type: Number, default: null },
    warranty: { type: String, default: "", trim: true },
    complianceCertificates: { type: [String], default: [] },
    stock: { type: Number, required: true, default: 0 },
    stockSyncedAt: { type: Date, default: null },
    priceSyncedAt: { type: Date, default: null },
    /** Out-of-stock flag for sync jobs */
    isOutOfStock: { type: Boolean, default: false },
    stockStatus: {
      type: String,
      enum: ["in_stock", "low_stock", "out_of_stock", "made_to_order", "preorder"],
      default: "in_stock",
    },

    tagline: { type: String },
    features: { type: [String], default: [] },
    colours: { type: [String], default: [] },
    materials: { type: [String], default: [] },
    finish: { type: String, default: "", trim: true },
    dimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
    keywords: { type: [String], default: [] },
    synonyms: { type: [String], default: [] },

    schematicImage: { type: String },
    specs: { type: mongoose.Schema.Types.Mixed, default: {} },
    showSpecs: { type: Boolean, default: true },
    variants: { type: [ProductVariantSchema], default: [] },
    downloads: { type: [ProductDownloadSchema], default: [] },
    technicalDrawings: { type: [String], default: [] },
    relatedProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    accessoryProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    sparePartProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },

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

// Covering indexes for the menu's department/category/subcategory counts —
// without these the aggregations are full collection scans.
ProductSchema.index({ department: 1, category: 1 });
ProductSchema.index({ department: 1, subCategory: 1 });
ProductSchema.index({ category: 1, createdAt: -1 });
ProductSchema.index({ subCategory: 1, createdAt: -1 });
ProductSchema.index({ department: 1, createdAt: -1 });
ProductSchema.index({ brand: 1, createdAt: -1 });
ProductSchema.index({ brands: 1 });
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ tradePrice: 1 });
ProductSchema.index({ stockStatus: 1 });
ProductSchema.index({
  name: "text",
  description: "text",
  linxSku: "text",
  supplierSku: "text",
  productCode: "text",
  keywords: "text",
  synonyms: "text",
});

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
if (mongoose.models.Product && !mongoose.models.Product.schema.path("department")) {
  mongoose.models.Product.schema.add({
    department: { type: String, default: "", trim: true, index: true },
    brands: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Brand" }],
      default: [],
    },
    tradePrice: { type: Number, default: null },
    videos: [{ type: String }],
    productCode: { type: String, default: "", trim: true, index: true },
    barcode: { type: String, default: "", trim: true },
    deliveryEstimateDays: { type: Number, default: null },
    stockStatus: {
      type: String,
      enum: ["in_stock", "low_stock", "out_of_stock", "made_to_order", "preorder"],
      default: "in_stock",
    },
    features: { type: [String], default: [] },
    colours: { type: [String], default: [] },
    materials: { type: [String], default: [] },
    finish: { type: String, default: "", trim: true },
    dimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
    keywords: { type: [String], default: [] },
    synonyms: { type: [String], default: [] },
    variants: { type: [ProductVariantSchema], default: [] },
    downloads: { type: [ProductDownloadSchema], default: [] },
    technicalDrawings: { type: [String], default: [] },
    relatedProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    accessoryProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    sparePartProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
  });
}

export const Product =
  mongoose.models.Product || mongoose.model("Product", ProductSchema);

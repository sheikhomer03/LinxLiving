import mongoose from "mongoose";

/**
 * Multi-supplier offer for a single product.
 * Product.supplier remains the preferred/primary link; this collection
 * holds alternate supplier quotes for selection.
 */
const ProductSupplierSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    supplierSku: { type: String, default: "", trim: true },
    manufacturerSku: { type: String, default: "", trim: true },
    costPrice: { type: Number, default: null },
    deliveryCost: { type: Number, default: null },
    stock: { type: Number, default: 0 },
    leadTimeDays: { type: Number, default: null },
    /** Lower = preferred when other scores tie */
    priority: { type: Number, default: 100 },
    isPreferred: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    currency: { type: String, default: "GBP", trim: true },
    lastStockSyncAt: { type: Date, default: null },
    lastPriceSyncAt: { type: Date, default: null },
    notes: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

ProductSupplierSchema.index({ product: 1, supplier: 1 }, { unique: true });
ProductSupplierSchema.index({ supplier: 1, isActive: 1 });

export const ProductSupplier =
  (mongoose.models.ProductSupplier as mongoose.Model<any>) ||
  mongoose.model("ProductSupplier", ProductSupplierSchema);

import mongoose from "mongoose";

const PurchaseOrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    name: { type: String, required: true },
    supplierSku: { type: String, default: "" },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, default: 0 },
    lineTotal: { type: Number, default: 0 },
  },
  { _id: false },
);

const PurchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, required: true, unique: true, index: true },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    /** Optional link to customer order */
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    orderNumber: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: [
        "Draft",
        "Submitted",
        "Confirmed",
        "Partially Received",
        "Received",
        "Cancelled",
        "Failed",
      ],
      default: "Draft",
      index: true,
    },
    items: { type: [PurchaseOrderItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    deliveryCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    currency: { type: String, default: "GBP" },
    /** Expected sell total for margin check */
    expectedSellTotal: { type: Number, default: null },
    estimatedMarginPercent: { type: Number, default: null },
    supplierConfirmationRef: { type: String, default: "" },
    trackingNumber: { type: String, default: "" },
    trackingCarrier: { type: String, default: "" },
    notes: { type: String, default: "" },
    submittedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

PurchaseOrderSchema.index({ createdAt: -1 });
PurchaseOrderSchema.index({ status: 1, createdAt: -1 });

export const PurchaseOrder =
  (mongoose.models.PurchaseOrder as mongoose.Model<any>) ||
  mongoose.model("PurchaseOrder", PurchaseOrderSchema);

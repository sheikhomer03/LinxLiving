import mongoose from "mongoose";

const SupplierSyncLogSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    connector: { type: String, default: "manual" },
    source: { type: String, default: "" },
    success: { type: Boolean, default: false },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    errors: { type: [String], default: [] },
    message: { type: String, default: "" },
  },
  { timestamps: true },
);

SupplierSyncLogSchema.index({ createdAt: -1 });

export const SupplierSyncLog =
  (mongoose.models.SupplierSyncLog as mongoose.Model<any>) ||
  mongoose.model("SupplierSyncLog", SupplierSyncLogSchema);

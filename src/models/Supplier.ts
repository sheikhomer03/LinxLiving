import mongoose from "mongoose";

const SupplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide a supplier name"],
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
    contactName: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    whatsapp: { type: String, default: "", trim: true },
    website: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    logo: { type: String, default: "", trim: true },
    defaultLeadTimeDays: { type: Number, default: null },
    /** Default gross margin % for this supplier's UK catalogue */
    defaultMarginPercent: { type: Number, default: 35 },
    /** Lower = preferred when auto-selecting */
    priority: { type: Number, default: 100 },
    country: { type: String, default: "GB", trim: true },
    currency: { type: String, default: "GBP", trim: true },
    isImport: { type: Boolean, default: false },

    /** Integration connector type */
    integrationType: {
      type: String,
      enum: [
        "manual",
        "csv",
        "rest",
        "xml",
        "json_feed",
        "ftp",
        "sftp",
        "edi",
      ],
      default: "manual",
    },
    apiEndpoint: { type: String, default: "", trim: true },
    feedUrl: { type: String, default: "", trim: true },
    feedFormat: { type: String, default: "", trim: true },
    /** Non-secret connector settings (paths, mapping keys, etc.) */
    connectorConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastStockSyncAt: { type: Date, default: null },
    lastPriceSyncAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },

    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

SupplierSchema.index({ isActive: 1, order: 1, name: 1 });
SupplierSchema.index({ integrationType: 1 });

if (
  mongoose.models.Supplier &&
  !mongoose.models.Supplier.schema.path("integrationType")
) {
  mongoose.models.Supplier.schema.add({
    defaultMarginPercent: { type: Number, default: 35 },
    priority: { type: Number, default: 100 },
    country: { type: String, default: "GB", trim: true },
    currency: { type: String, default: "GBP", trim: true },
    isImport: { type: Boolean, default: false },
    integrationType: {
      type: String,
      enum: [
        "manual",
        "csv",
        "rest",
        "xml",
        "json_feed",
        "ftp",
        "sftp",
        "edi",
      ],
      default: "manual",
    },
    apiEndpoint: { type: String, default: "", trim: true },
    feedUrl: { type: String, default: "", trim: true },
    feedFormat: { type: String, default: "", trim: true },
    connectorConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastStockSyncAt: { type: Date, default: null },
    lastPriceSyncAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },
  });
}

export const Supplier =
  (mongoose.models.Supplier as mongoose.Model<any>) ||
  mongoose.model("Supplier", SupplierSchema);

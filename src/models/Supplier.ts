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
    /** Display / company contact */
    contactName: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    /** E.164 preferred, e.g. +447700900123 — used for WhatsApp + tel */
    phone: { type: String, default: "", trim: true },
    whatsapp: { type: String, default: "", trim: true },
    website: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    logo: { type: String, default: "", trim: true },
    defaultLeadTimeDays: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

SupplierSchema.index({ isActive: 1, order: 1, name: 1 });

export const Supplier =
  (mongoose.models.Supplier as mongoose.Model<any>) ||
  mongoose.model("Supplier", SupplierSchema);

import mongoose from "mongoose";

const AddressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    company: { type: String },
    address1: { type: String, required: true },
    address2: { type: String },
    city: { type: String, required: true },
    county: { type: String },
    postcode: { type: String, required: true },
    country: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    shopifyAddressId: { type: String, default: null },
    shopifySyncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Address =
  mongoose.models.Address || mongoose.model("Address", AddressSchema);

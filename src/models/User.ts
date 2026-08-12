import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    image: { type: String },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    /** Trade customers pay TRADE_DISCOUNT_PERCENT less at checkout. */
    isTradeAccount: { type: Boolean, default: false },
    /** Company details captured on the trade application. */
    tradeCompanyName: { type: String, default: "", trim: true },
    tradeAppliedAt: { type: Date, default: null },
    tradeApprovedAt: { type: Date, default: null },
    resetOTP: { type: String },
    resetOTPExpiry: { type: Date },
    wishlist: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    shopifyCustomerId: { type: String, default: null, index: true },
    shopifySyncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = mongoose.models.User || mongoose.model("User", UserSchema);

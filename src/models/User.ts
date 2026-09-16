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
    /**
     * Trade customers pay TRADE_DISCOUNT_PERCENT less at checkout.
     *
     * Derived from `tradeStatus`, never set on its own: it stays the single
     * flag the rest of the site and the session already read, so approving an
     * application is the only thing that turns it on.
     */
    isTradeAccount: { type: Boolean, default: false },
    /**
     * Where a trade application stands.
     *
     * "none" is an ordinary shopper — the default, so every existing account
     * keeps logging in exactly as before. "pending" and "rejected" are refused
     * at sign-in (see lib/auth.ts): an unapproved trade account must not be
     * usable, and letting it in would hand out the account without the
     * discount and read as a bug rather than a decision.
     */
    tradeStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
      index: true,
    },
    /**
     * Department slugs the discount is limited to.
     *
     * Empty means every department — that is what the application form's "All
     * departments" option submits. A slug that later disappears from the
     * catalogue simply stops matching, which is the safe direction to fail.
     */
    tradeDepartments: { type: [String], default: [] },
    /** Company details captured on the trade application. */
    tradeCompanyName: { type: String, default: "", trim: true },
    tradePhone: { type: String, default: "", trim: true },
    tradeAppliedAt: { type: Date, default: null },
    tradeApprovedAt: { type: Date, default: null },
    tradeRejectedAt: { type: Date, default: null },
    /** Shown to the applicant in the rejection email. */
    tradeReviewNote: { type: String, default: "", trim: true },
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

/*
 * Re-register the model in development.
 *
 * `mongoose.models.User` is a process-wide cache, and Next's dev server keeps
 * it alive across hot reloads — so editing the schema above changes nothing
 * until the whole process restarts. Mongoose is strict by default, which makes
 * that failure silent rather than loud: a write naming a path the *cached*
 * schema has never heard of has that path quietly dropped, and the document is
 * saved without it. That is exactly how a trade application was stored with no
 * `tradeStatus`, leaving it invisible to the admin list that filters on it.
 *
 * Dropping the cached model here costs one re-compile per reload and makes a
 * schema edit take effect the moment the file is saved. Production keeps the
 * plain cache — nothing hot-reloads there.
 */
if (process.env.NODE_ENV !== "production" && mongoose.models.User) {
  mongoose.deleteModel("User");
}

export const User = mongoose.models.User || mongoose.model("User", UserSchema);

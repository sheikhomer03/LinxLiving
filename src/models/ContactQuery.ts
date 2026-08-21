import mongoose from "mongoose";

const ContactQuerySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Please provide your email address"],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    subject: {
      type: String,
      required: [true, "Please provide a subject"],
      trim: true,
    },
    message: {
      type: String,
      required: [true, "Please provide a message"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "replied", "archived"],
      default: "pending",
    },
    phone: { type: String, default: "", trim: true },
    company: { type: String, default: "", trim: true },
    /** When the customer ticked the data-storage consent box (UK GDPR record) */
    consentGivenAt: { type: Date, default: null },
    /** True when the enquiry saved but the staff notification email failed. */
    notificationFailed: { type: Boolean, default: false },
    /** Set when a signed-in customer raises the enquiry, so support can see
        their account without asking them to repeat details. */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    /** Set when the enquiry is about a specific order. */
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    /** Product the customer was viewing, for product-page enquiries. */
    productName: { type: String, default: "", trim: true },
    shopifyMetaobjectId: { type: String, default: null, index: true },
    shopifySyncedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

export const ContactQuery =
  mongoose.models.ContactQuery ||
  mongoose.model("ContactQuery", ContactQuerySchema);

import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    items: [
      {
        product: {
          type: String,
          required: true,
        },
        name: String,
        price: Number,
        quantity: { type: Number, default: 1 },
        image: String,
        isConfigured: { type: Boolean, default: false },
        configurationSummary: { type: String, default: null },
        configWidthMm: { type: Number, default: null },
        configHeightMm: { type: Number, default: null },
      },
    ],
    /** What the customer pays, including VAT */
    totalAmount: { type: Number, required: true },
    /** Goods total excluding VAT (prices are stored ex-VAT) */
    subtotalExVat: { type: Number, default: null },
    /** VAT charged on the discounted net + shipping */
    vatAmount: { type: Number, default: 0 },
    shippingCost: { type: Number, default: 0 },
    shippingAddress: {
      firstName: String,
      lastName: String,
      email: String,
      address: String,
      city: String,
      postcode: String,
      country: String,
      phone: String,
    },
    status: {
      type: String,
      enum: [
        "Processing",
        "Pending",
        "Confirmed Order",
        "Ordered from Supplier",
        "Awaiting Dispatch",
        "Dispatched",
        "Shipped",
        "Out for Delivery",
        "Delivered",
        "Returned",
        "Refunded",
        "Cancelled",
      ],
      default: "Processing",
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Pending",
    },
    paymentMethod: {
      type: String,
      enum: ["Stripe", "Cash on Delivery", "Shopify"],
      default: "Stripe",
    },
    orderNumber: { type: String, unique: true },
    /** Free-text delivery/access instructions from the customer */
    deliveryNotes: { type: String, default: "" },
    /** Set when reserved stock has been returned after an abandoned checkout */
    stockReleasedAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null },
    couponCode: { type: String, default: null },
    discountAmount: { type: Number, default: 0 },
    shopifyOrderId: { type: String, default: null, index: true },
    /** Shopify's own reference (e.g. "#1001"), kept alongside our LINX- number */
    shopifyOrderName: { type: String, default: null, index: true },
    shopifySyncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Force re-registration of the model in development to ensure schema changes are applied
if (process.env.NODE_ENV === "development" && mongoose.models.Order) {
  delete mongoose.models.Order;
}

export const Order =
  mongoose.models.Order || mongoose.model("Order", OrderSchema);

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
      },
    ],
    totalAmount: { type: Number, required: true },
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
        "Confirmed Order",
        "Shipped",
        "Out for Delivery",
        "Delivered",
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
      enum: ["Stripe", "Cash on Delivery"],
      default: "Stripe",
    },
    orderNumber: { type: String, unique: true },
    couponCode: { type: String, default: null },
    discountAmount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Force re-registration of the model in development to ensure schema changes are applied
if (process.env.NODE_ENV === "development" && mongoose.models.Order) {
  delete mongoose.models.Order;
}

export const Order =
  mongoose.models.Order || mongoose.model("Order", OrderSchema);

import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
        "Pending",
        "Processed",
        "Shipped",
        "Out for Delivery",
        "Delivered",
      ],
      default: "Pending",
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
  },
  { timestamps: true },
);

// Force re-registration of the model in development to ensure schema changes are applied
if (process.env.NODE_ENV === "development" && mongoose.models.Order) {
  delete mongoose.models.Order;
}

export const Order =
  mongoose.models.Order || mongoose.model("Order", OrderSchema);

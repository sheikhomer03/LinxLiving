import mongoose from "mongoose";
import { Order } from "../src/models/Order";
import { User } from "../src/models/User";
import { sendOrderConfirmation, sendOrderAdminNotification } from "../src/lib/mail";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/ecommerce-pro";
const orderId = process.argv[2];

if (!orderId) {
  console.error("Please provide an Order ID: pnpm ts-node scripts/test-order-email.ts <orderId>");
  process.exit(1);
}

async function test() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);

    console.log(`Fetching Order: ${orderId}...`);
    const order = await Order.findById(orderId);
    if (!order) {
      console.error("Order not found!");
      process.exit(1);
    }

    console.log(`Fetching User: ${order.user}...`);
    const user = await User.findById(order.user);
    if (!user || !user.email) {
      console.error("User or user email not found!");
      process.exit(1);
    }

    console.log(`Sending confirmation email to ${user.email}...`);
    await sendOrderConfirmation(user.email, order);
    
    console.log(`Sending admin notification...`);
    await sendOrderAdminNotification(order, order.shippingAddress);

    console.log("Success! Emails sent.");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

test();

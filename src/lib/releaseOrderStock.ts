import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";

/**
 * Return stock reserved by an unpaid order and mark it Cancelled.
 *
 * Stock is deducted when the order is created — before the customer reaches
 * the payment provider — so an abandoned or expired checkout would otherwise
 * hold that stock forever. Idempotent: an order that is already Paid or
 * Cancelled is left untouched.
 */
export async function releaseOrderStock(orderId: string, reason: string) {
  await connectDB();

  const order = await Order.findById(orderId);
  if (!order) return { success: false as const, error: "Order not found" };

  if (order.paymentStatus === "Paid") {
    return { success: false as const, error: "Order is paid — stock retained" };
  }
  if (order.stockReleasedAt) {
    return { success: true as const, alreadyReleased: true };
  }

  for (const item of order.items || []) {
    // Configurator lines are made to order, never stocked
    if (item.isConfigured || String(item.product || "").startsWith("cfg:")) {
      continue;
    }
    try {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: Number(item.quantity) || 0 },
      });
    } catch (err) {
      console.error(`Failed to restore stock for ${item.product}:`, err);
    }
  }

  order.stockReleasedAt = new Date();
  order.status = "Cancelled";
  order.paymentStatus = "Failed";
  order.cancellationReason = reason;
  await order.save();

  console.log(`Released stock for order ${order.orderNumber} — ${reason}`);
  return { success: true as const, alreadyReleased: false };
}

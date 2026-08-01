import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { User } from "@/models/User";
import { sendOrderConfirmation, sendOrderAdminNotification } from "@/lib/mail";
import { createPurchaseOrdersFromOrder } from "@/app/actions/purchaseOrders";

/**
 * Mark an order as Paid (idempotent). Optionally send confirmation emails
 * only on the first transition from Pending → Paid.
 * Also auto-creates supplier POs and emails suppliers when possible.
 */
export async function markOrderAsPaid(orderId: string) {
  await connectDB();

  const existing = await Order.findById(orderId);
  if (!existing) {
    return { success: false as const, error: "Order not found" };
  }

  if (existing.paymentStatus === "Paid") {
    return {
      success: true as const,
      order: JSON.parse(JSON.stringify(existing)),
      alreadyPaid: true,
    };
  }

  const updatedOrder = await Order.findByIdAndUpdate(
    orderId,
    { paymentStatus: "Paid" },
    { returnDocument: "after" },
  );

  if (!updatedOrder) {
    return { success: false as const, error: "Failed to update order" };
  }

  try {
    const user = await User.findById(updatedOrder.user);
    if (user?.email) {
      await sendOrderConfirmation(user.email, updatedOrder);
      await sendOrderAdminNotification(
        updatedOrder,
        updatedOrder.shippingAddress,
      );
    }
  } catch (emailErr) {
    console.error("Failed to send order confirmation emails:", emailErr);
  }

  // Auto purchase orders → email suppliers (non-blocking for payment success)
  try {
    await createPurchaseOrdersFromOrder(orderId, {
      autoEmailSuppliers: true,
    });
  } catch (poErr) {
    console.error("Auto PO creation failed:", poErr);
  }

  return {
    success: true as const,
    order: JSON.parse(JSON.stringify(updatedOrder)),
    alreadyPaid: false,
  };
}

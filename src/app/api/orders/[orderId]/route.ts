import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { User } from "@/models/User";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendOrderStatusUpdate, sendOrderConfirmation, sendOrderAdminNotification } from "@/lib/mail";

// ... GET handler stays the same ...
export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  try {
    await connectDB();
    const order = await Order.findById(orderId).populate("user", "name email");

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, order }, { status: 200 });
  } catch (error: any) {
    console.error("Fetch Order Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized access" },
        { status: 401 },
      );
    }

    const { orderId } = await params;
    const body = await req.json();
    const { status, paymentStatus } = body;

    await connectDB();

    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const update: Record<string, string> = {};

    if (status !== undefined) {
      const allowedStatuses = [
        "Processing",
        "Confirmed Order",
        "Shipped",
        "Out for Delivery",
        "Delivered",
        "Cancelled",
      ];

      if (!allowedStatuses.includes(status)) {
        return NextResponse.json(
          { error: "Invalid status value" },
          { status: 400 },
        );
      }
      update.status = status;
    }

    if (paymentStatus !== undefined) {
      const allowedPayment = ["Pending", "Paid", "Failed"];
      if (!allowedPayment.includes(paymentStatus)) {
        return NextResponse.json(
          { error: "Invalid payment status value" },
          { status: 400 },
        );
      }
      update.paymentStatus = paymentStatus;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const oldStatus = existingOrder.status;
    const wasPaid = existingOrder.paymentStatus === "Paid";

    const updatedOrder = await Order.findByIdAndUpdate(orderId, update, {
      returnDocument: "after",
      runValidators: true,
    });

    // Emails when admin manually confirms Stripe payment
    if (updatedOrder && !wasPaid && paymentStatus === "Paid") {
      const user = await User.findById(updatedOrder.user);
      const toEmail = user?.email || updatedOrder.shippingAddress?.email;
      if (toEmail) {
        try {
          await sendOrderConfirmation(toEmail, updatedOrder);
          await sendOrderAdminNotification(
            updatedOrder,
            updatedOrder.shippingAddress,
          );
        } catch (emailErr) {
          console.error("Failed to send payment confirmation emails:", emailErr);
        }
      }
    }

    // Email customer on every fulfillment status change
    if (updatedOrder && status && oldStatus !== status) {
      const user = await User.findById(updatedOrder.user);
      const toEmail = user?.email || updatedOrder.shippingAddress?.email;
      if (toEmail) {
        try {
          await sendOrderStatusUpdate(toEmail, updatedOrder, status);
        } catch (emailErr) {
          console.error("Failed to send status update email:", emailErr);
        }
      } else {
        console.warn(
          `No customer email found for order ${updatedOrder.orderNumber}`,
        );
      }
    }

    return NextResponse.json(
      { success: true, order: updatedOrder },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Update Order Status Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

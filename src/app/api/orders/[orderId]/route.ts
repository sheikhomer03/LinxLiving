import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { User } from "@/models/User";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendOrderStatusUpdate } from "@/lib/mail";

// ... GET handler stays the same ...
export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  console.log("orderId", orderId);
  try {
    await connectDB();
    const order = await Order.findById(orderId);

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
    const { status } = await req.json();

    const allowedStatuses = [
      "Pending",
      "Processed",
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

    await connectDB();

    // Fetch old order to compare status
    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const oldStatus = existingOrder.status;

    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true, runValidators: true },
    );

    // Send email if status changed to Shipped, Out for Delivery, Delivered, or Cancelled
    if (
      updatedOrder &&
      oldStatus !== status &&
      ["Shipped", "Out for Delivery", "Delivered", "Cancelled"].includes(status)
    ) {
      const user = await User.findById(updatedOrder.user);
      if (user && user.email) {
        try {
          await sendOrderStatusUpdate(user.email, updatedOrder, status);
          console.log(
            `INFO: Status update email sent for order ${orderId} (${status})`,
          );
        } catch (emailErr) {
          console.error("Failed to send status update email:", emailErr);
        }
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

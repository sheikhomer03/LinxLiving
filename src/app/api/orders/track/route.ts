import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import "@/models/User";
import mongoose from "mongoose";

function normalizeOrderId(value: string) {
  return String(value || "")
    .trim()
    .replace(/^#/, "");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderId = normalizeOrderId(body.orderId || body.orderNumber || "");

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 },
      );
    }

    await connectDB();

    let order = await Order.findOne({ orderNumber: orderId }).populate(
      "user",
      "name email",
    );

    if (!order && mongoose.Types.ObjectId.isValid(orderId)) {
      order = await Order.findById(orderId).populate("user", "name email");
    }

    if (!order) {
      return NextResponse.json(
        { error: "No order found for that ID" },
        { status: 404 },
      );
    }

    const subtotal = (order.items || []).reduce(
      (acc: number, item: { price?: number; quantity?: number }) =>
        acc + (item.price || 0) * (item.quantity || 1),
      0,
    );

    const tracked = {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      totalAmount: order.totalAmount,
      discountAmount: order.discountAmount || 0,
      couponCode: order.couponCode || null,
      shippingMethod:
        (order as { shippingMethod?: string }).shippingMethod || null,
      items: (order.items || []).map(
        (item: {
          name?: string;
          price?: number;
          quantity?: number;
          image?: string;
        }) => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image || "",
        }),
      ),
      shippingAddress: {
        firstName: order.shippingAddress?.firstName,
        lastName: order.shippingAddress?.lastName,
        address: order.shippingAddress?.address,
        city: order.shippingAddress?.city,
        postcode: order.shippingAddress?.postcode,
        country: order.shippingAddress?.country,
      },
      subtotal,
    };

    return NextResponse.json({ success: true, order: tracked }, { status: 200 });
  } catch (error: unknown) {
    console.error("Track Order Error:", error);
    const message =
      error instanceof Error ? error.message : "Unable to track order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

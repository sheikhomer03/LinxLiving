import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const host = req.headers.get("host");
    const nextAuthUrl = process.env.NEXTAUTH_URL;

    console.log(
      "DEBUG: Order Creation Session:",
      !!session,
      session?.user?.email,
    );
    console.log("DEBUG: Host:", host, "NEXTAUTH_URL:", nextAuthUrl);

    if (!session?.user) {
      console.warn(
        "DEBUG: Unauthorized access attempt to /api/orders. host:",
        host,
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      items,
      totalAmount,
      shippingAddress,
      shippingMethod,
      paymentMethod,
    } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items in order" }, { status: 400 });
    }

    await connectDB();

    // Generate a luxury order number (AUREL-XXXX)
    const orderNumber = `AUREL-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;

    const order = await Order.create({
      user: session.user.id,
      items: items.map((item: any) => ({
        product: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        image: item.image,
      })),
      totalAmount,
      shippingAddress,
      shippingMethod,
      paymentMethod: paymentMethod || "Stripe",
      orderNumber,
      paymentStatus:
        paymentMethod === "Cash on Delivery" ? "Pending" : "Pending",
      status: "Pending",
    });

    return NextResponse.json({ success: true, order }, { status: 201 });
  } catch (error: any) {
    console.error("Order Creation Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    let orders;
    const role = (session.user as any).role;

    if (role === "admin") {
      // Admin sees all orders
      orders = await Order.find().sort({ createdAt: -1 });
    } else {
      // Regular user sees only their own orders
      orders = await Order.find({ user: (session.user as any).id }).sort({
        createdAt: -1,
      });
    }

    return NextResponse.json({ success: true, orders }, { status: 200 });
  } catch (error: any) {
    console.error("Fetch Orders Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

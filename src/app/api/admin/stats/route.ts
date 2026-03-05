import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { User } from "@/models/User";
import { Product } from "@/models/Product";
import { Subscriber } from "@/models/Subscriber";
import { ContactQuery } from "@/models/ContactQuery";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    // Fetch all required counts and sums
    const [
      orders,
      totalCustomers,
      totalProducts,
      totalSubscribers,
      totalPendingQueries,
    ] = await Promise.all([
      Order.find({}),
      User.countDocuments({ role: "user" }),
      Product.countDocuments({}),
      Subscriber.countDocuments({}),
      ContactQuery.countDocuments({ status: "pending" }),
    ]);

    const totalSales = orders.reduce(
      (acc, order) => acc + order.totalAmount,
      0,
    );
    const totalOrders = orders.length;

    return NextResponse.json(
      {
        success: true,
        stats: {
          totalSales,
          totalOrders,
          totalCustomers,
          totalProducts,
          totalSubscribers,
          totalPendingQueries,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Fetch Stats Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

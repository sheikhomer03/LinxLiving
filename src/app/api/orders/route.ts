import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { Coupon } from "@/models/Coupon";
import { Product } from "@/models/Product";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendOrderConfirmation, sendOrderAdminNotification } from "@/lib/mail";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    const body = await req.json();
    const {
      items,
      totalAmount,
      shippingAddress,
      shippingMethod,
      paymentMethod,
      couponCode,
      discountAmount,
    } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items in order" }, { status: 400 });
    }

    const guestEmail = shippingAddress?.email?.trim();
    if (!session?.user?.id && !guestEmail) {
      return NextResponse.json(
        { error: "Email is required for checkout" },
        { status: 400 },
      );
    }

    await connectDB();

    // Deduct stock first; roll back if any item fails
    const deducted: { id: string; qty: number }[] = [];

    try {
      for (const item of items) {
        const qty = Number(item.quantity) || 0;
        if (!item.id || qty <= 0) {
          throw new Error("Invalid order item");
        }

        // Made-to-measure configurator lines are not stocked SKUs
        if (item.isConfigured || String(item.id).startsWith("cfg:")) {
          continue;
        }

        const updated = await Product.findOneAndUpdate(
          { _id: item.id, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: true },
        );

        if (!updated) {
          throw new Error(
            `Insufficient stock for ${item.name || "a product in your cart"}`,
          );
        }

        deducted.push({ id: item.id, qty });
      }

      const orderNumber = `AUREL-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;

      const order = await Order.create({
        ...(session?.user?.id ? { user: session.user.id } : {}),
        items: items.map((item: any) => ({
          product: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image,
          isConfigured: Boolean(item.isConfigured),
          configurationSummary: item.configurationSummary || null,
          configWidthMm: item.configWidthMm ?? null,
          configHeightMm: item.configHeightMm ?? null,
        })),
        totalAmount,
        shippingAddress,
        shippingMethod,
        paymentMethod: paymentMethod || "Stripe",
        orderNumber,
        paymentStatus:
          paymentMethod === "Cash on Delivery" ? "Pending" : "Pending",
        status: "Processing",
        couponCode: couponCode || null,
        discountAmount: discountAmount || 0,
      });

      if (couponCode) {
        await Coupon.findOneAndUpdate(
          { code: couponCode.toUpperCase() },
          { $inc: { usedCount: 1 } },
        );
      }

      if (paymentMethod === "Cash on Delivery") {
        try {
          const { isShopifySyncEnabled } = await import("@/lib/shopify");
          if (isShopifySyncEnabled()) {
            const { pushOrderToShopify } = await import(
              "@/lib/shopify/sync-order"
            );
            const shopifyOrderId = await pushOrderToShopify(order.toObject());
            if (shopifyOrderId) {
              order.shopifyOrderId = shopifyOrderId;
              order.shopifySyncedAt = new Date();
              order.paymentMethod = "Cash on Delivery";
              await order.save();
            }
          }
        } catch (shopifyError) {
          console.error("Shopify COD order sync failed:", shopifyError);
        }

        const confirmEmail = session?.user?.email || guestEmail;
        try {
          if (confirmEmail) {
            await sendOrderConfirmation(confirmEmail, order);
          }
          await sendOrderAdminNotification(order, {
            firstName: shippingAddress.firstName,
            lastName: shippingAddress.lastName,
            email: confirmEmail,
          });
        } catch (emailError) {
          console.error("COD Email Notification Error:", emailError);
        }
      }

      return NextResponse.json({ success: true, order }, { status: 201 });
    } catch (stockError: any) {
      // Restore any stock already deducted
      await Promise.all(
        deducted.map((d) =>
          Product.findByIdAndUpdate(d.id, { $inc: { stock: d.qty } }),
        ),
      );
      throw stockError;
    }
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

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50),
    );
    const skip = (page - 1) * limit;
    const search = String(searchParams.get("search") || "").trim();

    let filter: Record<string, unknown> = {};
    const role = (session.user as any).role;

    if (role !== "admin") {
      filter = { user: (session.user as any).id };
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = { $regex: escaped, $options: "i" };
      filter = {
        ...filter,
        $or: [
          { orderNumber: rx },
          { "shippingAddress.firstName": rx },
          { "shippingAddress.lastName": rx },
          { "shippingAddress.email": rx },
          { couponCode: rx },
        ],
      };
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);

    return NextResponse.json(
      {
        success: true,
        orders,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Fetch Orders Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

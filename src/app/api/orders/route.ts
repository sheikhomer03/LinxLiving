import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Order } from "@/models/Order";
import { Coupon } from "@/models/Coupon";
import { Product } from "@/models/Product";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendOrderConfirmation, sendOrderAdminNotification } from "@/lib/mail";
import { User } from "@/models/User";
import { tradeDiscountAmount } from "@/lib/trade";
import { verifyConfiguredUnitPrice } from "@/lib/configuredPrice";
import mongoose from "mongoose";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    const body = await req.json();
    const {
      items,
      totalAmount,
      subtotalExVat,
      vatAmount,
      shippingCost,
      shippingAddress,
      shippingMethod,
      deliveryNotes,
      paymentMethod,
      couponCode,
      discountAmount,
      tradeModeOn,
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

    // Real trade accounts are re-derived from the account, never trusted
    // from the browser — otherwise anyone could post isTradeAccount and take
    // 5% off. Self-serve Trade Mode has no account to check against, so it
    // is accepted from the request body at the same trust level the rest of
    // this checkout body already has (e.g. item prices).
    let isRealTradeAccount = false;
    if (session?.user?.id) {
      const account = await User.findById(session.user.id).select(
        "isTradeAccount",
      );
      isRealTradeAccount = Boolean(account?.isTradeAccount);
    }
    const isTrade = isRealTradeAccount || Boolean(tradeModeOn);
    const goodsTotal = (items || []).reduce(
      (sum: number, i: any) =>
        sum + (Number(i.price) || 0) * (Number(i.quantity) || 0),
      0,
    );
    const serverTradeDiscount = tradeDiscountAmount(goodsTotal, isTrade);

    // Deduct stock first; roll back if any item fails
    const deducted: { id: string; qty: number }[] = [];

    try {
      for (const item of items) {
        const qty = Number(item.quantity) || 0;
        if (!item.id || qty <= 0) {
          throw new Error("Invalid order item");
        }

        // Made-to-measure configurator lines are not stocked SKUs, but their
        // price came from the browser, so it is checked against the product
        // before the order is written — Cash on Delivery must not be a way
        // around the check the Shopify route already applies.
        if (item.isConfigured || String(item.id).startsWith("cfg:")) {
          const configuredId = String(
            item.productId || String(item.id).split("::")[0] || "",
          );
          const configuredProduct = mongoose.Types.ObjectId.isValid(configuredId)
            ? await Product.findById(configuredId).lean()
            : null;
          if (configuredProduct) {
            const verdict = verifyConfiguredUnitPrice(
              configuredProduct as Record<string, unknown>,
              {
                kind: item.configKind ?? null,
                quantity: qty,
                claimedUnitPrice: Number(item.price),
                areaM2: item.configAreaM2 ?? null,
                packs: item.configPacks ?? null,
                widthMm: item.configWidthMm ?? null,
                heightMm: item.configHeightMm ?? null,
                variantSku: item.configVariantSku ?? null,
                pooky: item.configPooky ?? null,
              },
            );
            if (!verdict.ok) {
              console.warn(
                `[orders] configured line refused: product=${configuredId} claimed=${item.price} floor=${verdict.floor} basis=${verdict.basis}`,
              );
              throw new Error(verdict.error || "This item's price has changed.");
            }
          }
          continue;
        }

        // `id` is the cart-line key and carries the chosen option
        // ("<productId>::CHROME-900"); stock lives on the product itself.
        const stockedId = String(
          item.productId || String(item.id).split("::")[0] || item.id,
        );

        const updated = await Product.findOneAndUpdate(
          { _id: stockedId, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: true },
        );

        if (!updated) {
          throw new Error(
            `Insufficient stock for ${item.name || "a product in your cart"}`,
          );
        }

        deducted.push({ id: stockedId, qty });
      }

      const orderNumber = `LINX-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;

      const order = await Order.create({
        ...(session?.user?.id ? { user: session.user.id } : {}),
        items: items.map((item: any) => ({
          // The product, not the cart-line key — releaseOrderStock() and the
          // admin order view both look this up as a product id.
          product:
            item.productId || String(item.id).split("::")[0] || item.id,
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
        subtotalExVat: subtotalExVat ?? null,
        vatAmount: vatAmount ?? 0,
        shippingCost: shippingCost ?? 0,
        shippingAddress,
        shippingMethod,
        deliveryNotes: String(deliveryNotes || "").slice(0, 500),
        paymentMethod: paymentMethod || "Stripe",
        orderNumber,
        paymentStatus:
          paymentMethod === "Cash on Delivery" ? "Pending" : "Pending",
        status: "Processing",
        couponCode: couponCode || null,
        discountAmount: discountAmount || 0,
        tradeDiscount: serverTradeDiscount,
        isTradeOrder: isTrade,
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

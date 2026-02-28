import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16" as any, // Use a stable API version
});

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    console.log("DEBUG: Checkout Session:", !!session, session?.user?.email);

    if (!session?.user) {
      console.warn(
        "DEBUG: Unauthorized access attempt to /api/checkout. Headers:",
        Object.fromEntries(req.headers.entries()),
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { items, orderId, email } = await req.json();
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    console.log("DEBUG: Checkout Request Params:", {
      items: items?.length,
      orderId,
      email,
      baseUrl,
    });

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items in cart" }, { status: 400 });
    }

    const lineItems = items.map((item: any) => {
      // Ensure image URL is absolute
      let imageUrl = item.image;
      if (imageUrl && imageUrl.startsWith("/")) {
        imageUrl = `${baseUrl}${imageUrl}`;
      }

      return {
        price_data: {
          currency: "gbp",
          product_data: {
            name: item.name,
            images: imageUrl ? [imageUrl] : [],
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      };
    });

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: lineItems,
      success_url: `${baseUrl}/checkout/success/${orderId}`,
      cancel_url: `${baseUrl}/checkout/review`,
      customer_email: email,
      metadata: {
        orderId,
      },
    });

    console.log(
      "DEBUG: Stripe Session Created successfully:",
      checkoutSession.id,
    );

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error: any) {
    console.error("CRITICAL: Stripe Checkout Error:", {
      message: error.message,
      stack: error.stack,
      raw: error,
    });
    return NextResponse.json(
      {
        error: error.message || "An unexpected error occurred during checkout",
      },
      { status: 500 },
    );
  }
}

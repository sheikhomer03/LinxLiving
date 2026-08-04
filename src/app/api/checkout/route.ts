import { NextResponse } from "next/server";
import Stripe from "stripe";
import { calculateVat, singleVatRate } from "@/lib/vat";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16" as any, // Use a stable API version
});

export async function POST(req: Request) {
  try {
    const { items, orderId, email, discountAmount, shippingCost, origin } =
      await req.json();
    const baseUrl = origin || process.env.NEXTAUTH_URL || "http://localhost:3000";

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items in cart" }, { status: 400 });
    }

    if (!email) {
      return NextResponse.json(
        { error: "Email is required for checkout" },
        { status: 400 },
      );
    }

    const lineItems = items.map((item: any) => {
      // Ensure image URL is absolute
      let imageUrl = item.image;
      if (imageUrl && imageUrl.startsWith("/")) {
        imageUrl = `${baseUrl}${imageUrl}`;
      }

      const description =
        item.configurationSummary ||
        (item.isConfigured ? "Made to measure configuration" : undefined);

      return {
        price_data: {
          currency: "gbp",
          product_data: {
            name: item.name,
            ...(description ? { description: String(description).slice(0, 500) } : {}),
            images: imageUrl ? [imageUrl] : [],
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      };
    });

    // Add shipping line item if applicable
    if (shippingCost && shippingCost > 0) {
      lineItems.push({
        price_data: {
          currency: "gbp",
          product_data: {
            name: "Shipping & Handling",
          },
          unit_amount: Math.round(shippingCost * 100),
        },
        quantity: 1,
      });
    }

    // VAT as its own line so the customer sees it on the Stripe page and the
    // charged total matches the checkout summary. Recomputed here rather than
    // trusted from the client. The discount coupon below reduces the session
    // total by `discountAmount`, and VAT is already calculated on the
    // discounted net — so the arithmetic lines up exactly.
    const vat = calculateVat({
      lines: (items || []).map((i: any) => ({
        price: Number(i.price) || 0,
        quantity: Number(i.quantity) || 0,
        vatRate: i.vatRate,
      })),
      discountAmount: Number(discountAmount) || 0,
      shippingCost: Number(shippingCost) || 0,
    });

    if (vat.vatAmount > 0) {
      const rate = singleVatRate(
        (items || []).map((i: any) => ({
          price: 0,
          quantity: 0,
          vatRate: i.vatRate,
        })),
      );
      lineItems.push({
        price_data: {
          currency: "gbp",
          product_data: {
            name: rate != null ? `VAT (${rate}%)` : "VAT",
          },
          unit_amount: Math.round(vat.vatAmount * 100),
        },
        quantity: 1,
      });
    }

    // Handle discounts via Stripe Coupons
    const discounts = [];
    if (discountAmount && discountAmount > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: Math.round(discountAmount * 100),
        currency: "gbp",
        duration: "once",
        name: "Promotional Discount",
      });
      discounts.push({ coupon: coupon.id });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: lineItems,
      discounts,
      success_url: `${baseUrl}/checkout/success/${orderId}`,
      cancel_url: `${baseUrl}/checkout/review`,
      customer_email: email,
      metadata: {
        orderId,
      },
      payment_intent_data: {
        metadata: {
          orderId,
        },
      },
    });

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

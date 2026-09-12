import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";
import { tradeDiscountForLines } from "@/lib/trade";
import { resolveTradeScope } from "@/lib/tradeServer";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16" as any, // Use a stable API version
});

export async function POST(req: Request) {
  try {
    const {
      items,
      orderId,
      email,
      discountAmount,
      tradeModeOn,
      shippingCost,
      origin,
    } = await req.json();
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

    // Prices already include VAT, so Stripe charges the gross line prices
    // directly. Adding a VAT line here would charge the customer twice.

    // Real trade accounts: discount recomputed from the account — the
    // browser-supplied discountAmount is only trusted for promo codes, which
    // Stripe validates separately. Anything the customer could forge is
    // recalculated here. Self-serve Trade Mode has no account to re-verify
    // against, so tradeModeOn is accepted as-is (same trust level as the
    // item prices already flowing into these line items).
    // Summed from the lines the account actually covers — a trade account may
    // be approved for only some departments. See lib/tradeServer.ts.
    const tradeScope = await resolveTradeScope(tradeModeOn);
    const tradeOff = tradeDiscountForLines(
      (items || []).map((i: any) => ({
        price: Number(i.price) || 0,
        quantity: Number(i.quantity) || 0,
        department: i.department ?? null,
      })),
      tradeScope,
    );

    // Handle discounts via Stripe Coupons
    const discounts = [];
    const totalOff =
      Math.round(((Number(discountAmount) || 0) + tradeOff) * 100) / 100;
    if (totalOff > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: Math.round(totalOff * 100),
        currency: "gbp",
        duration: "once",
        name: "Promotional Discount",
      });
      discounts.push({ coupon: coupon.id });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      // `payment_method_types` is deliberately omitted. It was hardcoded to
      // ["card"], so Klarna and PayPal could never appear even once enabled on
      // the Stripe account. Left out, Checkout offers whatever is switched on
      // in the Stripe Dashboard and eligible for this currency and amount —
      // so enabling a method there is all that is needed, and nothing breaks
      // if none are.
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

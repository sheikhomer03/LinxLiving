import { NextResponse } from "next/server";
import Stripe from "stripe";
import { headers } from "next/headers";
import { markOrderAsPaid } from "@/lib/markOrderPaid";
import { releaseOrderStock } from "@/lib/releaseOrderStock";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16" as any,
});

export async function POST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature") as string;

  if (!signature) {
    console.error("CRITICAL: Missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (error: any) {
    console.error(
      "CRITICAL: Webhook Signature Verification Failed:",
      error.message,
    );
    return NextResponse.json(
      { error: `Webhook Error: ${error.message}` },
      { status: 400 },
    );
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;

      if (orderId) {
        const result = await markOrderAsPaid(orderId);
        if (!result.success) {
          console.warn("Webhook: could not mark order paid:", result.error);
        }
      } else {
        console.warn(
          "WARN: Checkout session completed but no orderId found in metadata.",
        );
      }
    } else if (event.type === "checkout.session.expired") {
      // Customer abandoned the hosted checkout. Stock was reserved when the
      // order was created, so it must go back to sellable inventory.
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;

      if (orderId) {
        await releaseOrderStock(orderId, "Stripe checkout session expired");
      }
    } else if (
      event.type === "payment_intent.payment_failed" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      const object = event.data.object as
        | Stripe.PaymentIntent
        | Stripe.Checkout.Session;
      const orderId = object.metadata?.orderId;

      if (orderId) {
        await releaseOrderStock(orderId, `Payment failed (${event.type})`);
        console.error(`ERROR: Payment failed for Order ${orderId}`);
      }
    }
  } catch (error: any) {
    console.error("CRITICAL: Error processing webhook event:", error);
    return NextResponse.json(
      { error: "Internal server error during webhook" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Search, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildTrackingSteps } from "@/lib/orderTracking";

type TrackedOrder = {
  orderNumber: string;
  shopifyOrderName?: string | null;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  createdAt: string;
  totalAmount: number;
  discountAmount: number;
  couponCode: string | null;
  shippingMethod: string | null;
  subtotal: number;
  items: {
    name: string;
    price: number;
    quantity: number;
    image: string;
  }[];
  shippingAddress: {
    firstName?: string;
    lastName?: string;
    address?: string;
    city?: string;
    postcode?: string;
    country?: string;
  };
};

const JOURNEY = [
  { label: "Processing", detail: "Order received and prepared" },
  { label: "In transit", detail: "Handed to our courier" },
  { label: "Delivered", detail: "Arrives at your address" },
];

/** The page's small caps, as on /about, /faq and /contact. */
const EYEBROW =
  "font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/45 lg:text-[10px]";

export function TrackOrderForm() {
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<TrackedOrder | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOrder(null);

    const trimmedId = orderId.trim();

    if (!trimmedId) {
      setError("Please enter your order ID");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/orders/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: trimmedId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Unable to find this order");
        return;
      }

      setOrder(data.order);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setOrder(null);
    setError("");
  };

  if (order) {
    const steps = buildTrackingSteps(order.status, order.createdAt);

    return (
      <section className="px-4 py-12 lg:px-8 lg:py-16">
        <div className="mx-auto max-w-[1200px]">
          {/* Order header — the status carried beside the number rather than
              in a separate dark band. */}
          <div className="flex flex-col gap-6 border-b border-black/10 pb-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <p className={EYEBROW}>Live status</p>
              <h2 className="mt-3 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
                Order #{order.orderNumber}
              </h2>
              {order.shopifyOrderName &&
              order.shopifyOrderName !== order.orderNumber ? (
                <p className="mt-3 text-[12px] leading-relaxed text-foreground/55 sm:text-[13px]">
                  Also shown as{" "}
                  <span className="text-foreground">
                    {order.shopifyOrderName}
                  </span>{" "}
                  on your payment confirmation
                </p>
              ) : null}
              <p className="mt-1 text-[12px] text-foreground/55 sm:text-[13px]">
                Placed{" "}
                {new Date(order.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="shrink-0 md:text-right">
              <p className={EYEBROW}>Current status</p>
              <p className="mt-3 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
                {order.status}
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-foreground/50">
                Payment · {order.paymentStatus}
              </p>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <p className={EYEBROW}>Journey</p>
              <h3 className="mt-3 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
                Delivery timeline
              </h3>

              {/* The rule runs through the markers rather than beside icon
                  discs — there are no filled circles anywhere else on the
                  converted pages. */}
              <ol className="relative mt-8 before:absolute before:bottom-4 before:left-[5px] before:top-4 before:w-px before:bg-black/10">
                {steps.map((step) => {
                  const active = step.completed || step.current;
                  return (
                    <li key={step.status} className="relative flex gap-6 py-4">
                      <span
                        aria-hidden
                        className={cn(
                          "relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 border",
                          step.completed
                            ? "border-foreground bg-foreground"
                            : step.current
                              ? "border-foreground bg-background"
                              : "border-black/20 bg-background",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h4
                            className={cn(
                              "text-[11px] font-bold uppercase tracking-[0.12em]",
                              active ? "text-foreground" : "text-foreground/35",
                            )}
                          >
                            {step.status}
                          </h4>
                          <p
                            className={cn(
                              "text-[10px] uppercase tracking-[0.12em]",
                              active
                                ? "text-foreground/55"
                                : "text-foreground/30",
                            )}
                          >
                            {step.date}
                          </p>
                        </div>
                        <p
                          className={cn(
                            "mt-1.5 text-[12px] leading-relaxed sm:text-[13px]",
                            active ? "text-foreground/65" : "text-foreground/30",
                          )}
                        >
                          {step.description}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="lg:col-span-5">
              <div className="border border-black/10 p-6 lg:p-8">
                <p className={EYEBROW}>Delivery address</p>
                <p className="mt-3 text-[13px] leading-relaxed text-foreground/70">
                  {order.shippingAddress.firstName}{" "}
                  {order.shippingAddress.lastName}
                  <br />
                  {order.shippingAddress.address}
                  <br />
                  {order.shippingAddress.city}
                  {order.shippingAddress.postcode
                    ? `, ${order.shippingAddress.postcode}`
                    : ""}
                  <br />
                  {order.shippingAddress.country}
                </p>

                <div className="mt-8 border-t border-black/10 pt-6">
                  <p className={EYEBROW}>Items in shipment</p>
                  <ul className="mt-4 space-y-4">
                    {order.items.map((item, i) => (
                      <li key={i} className="flex items-center gap-4">
                        <span className="h-14 w-14 shrink-0 overflow-hidden bg-secondary">
                          {item.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-bold uppercase tracking-[0.08em] text-foreground">
                            {item.name}
                          </span>
                          <span className="mt-1 block text-[11px] tabular-nums text-foreground/55">
                            Qty {item.quantity} · £
                            {Number(item.price).toFixed(2)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8 space-y-2 border-t border-black/10 pt-6">
                  <div className="flex justify-between text-[11px] uppercase tracking-[0.12em] text-foreground/55">
                    <span>Subtotal</span>
                    <span className="tabular-nums">
                      £{order.subtotal.toFixed(2)}
                    </span>
                  </div>
                  {order.discountAmount > 0 && (
                    <div className="flex justify-between text-[11px] uppercase tracking-[0.12em] text-foreground">
                      <span>
                        Discount
                        {order.couponCode ? ` (${order.couponCode})` : ""}
                      </span>
                      <span className="tabular-nums">
                        -£{order.discountAmount.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between border-t border-black/10 pt-3 text-[12px] font-bold uppercase tracking-[0.18em]">
                    <span>Total</span>
                    <span className="tabular-nums">
                      £{Number(order.totalAmount).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 border border-black/10 p-6 lg:p-8">
                <p className={EYEBROW}>Need help?</p>
                <p className="mt-3 text-[13px] leading-relaxed text-foreground/70">
                  Questions about this delivery? Our team can help.
                </p>
                <Link
                  href="/contact"
                  className="group mt-4 inline-block font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-foreground lg:text-[10px]"
                >
                  Contact us
                  <ArrowRight className="ml-2 inline-block h-3 w-3 shrink-0 align-middle transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="mt-6 w-full border border-black/20 py-3.5 text-[10px] font-medium uppercase tracking-[0.22em] text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
              >
                Track another order
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 py-12 lg:px-8 lg:py-16">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5 self-start lg:sticky lg:top-32">
          <p className={EYEBROW}>Client service</p>
          <h2 className="mt-4 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
            Where is my order?
          </h2>
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-foreground/70 sm:text-sm">
            Follow your materials from warehouse to door — enter the order ID
            from your confirmation email.
          </p>

          {/* Numbered, as the propositions on /about are: an icon in a ring is
              not a mark this design system makes. */}
          <ol className="mt-10 border-t border-black/10">
            {JOURNEY.map((step, i) => (
              <li
                key={step.label}
                className="flex gap-6 border-b border-black/10 py-5"
              >
                <span className="font-menu shrink-0 pt-0.5 text-[9px] font-medium uppercase tracking-[1.4px] text-black/30 lg:text-[10px]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-foreground sm:text-xs">
                    {step.label}
                  </span>
                  <span className="mt-1.5 block text-[12px] leading-relaxed text-foreground/55 sm:text-[13px]">
                    {step.detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <p className="mt-6 text-[11px] leading-relaxed text-foreground/50">
            Your order ID is in the confirmation email we sent when the order
            was placed.
          </p>
        </div>

        <div className="lg:col-span-7">
          <form
            onSubmit={handleSubmit}
            className="border border-black/10 p-5 sm:p-8 lg:p-10"
          >
            <p className={EYEBROW}>Enter your details</p>
            <h2 className="mt-3 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
              Find your shipment
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-foreground/70 sm:text-sm">
              Use the order ID from your confirmation email to check live
              status.
            </p>

            <div className="mt-8">
              <label htmlFor="track-order-id" className={EYEBROW}>
                Order ID
              </label>
              <input
                id="track-order-id"
                type="text"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="e.g. LINX-AB12-1234 or #1001"
                autoComplete="off"
                className="mt-3 w-full border border-black/20 bg-white px-4 py-3.5 text-sm outline-none transition-colors hover:border-black/40 focus:border-foreground focus:ring-2 focus:ring-foreground/10"
              />
            </div>

            {error ? (
              <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.12em] text-red-600">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-8 inline-flex w-full items-center justify-center gap-3 bg-black px-12 py-4 text-[10px] font-medium uppercase tracking-[0.22em] text-white transition-colors hover:bg-black/85 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 stroke-[1.5]" />
                  Track order
                </>
              )}
            </button>

            <p className="mt-5 text-center text-[11px] text-foreground/55">
              Need help?{" "}
              <Link
                href="/contact"
                className="font-medium text-foreground underline underline-offset-4 decoration-black/20 hover:decoration-foreground"
              >
                Contact us
              </Link>
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/layout/BrandLogo";
import {
  PackageSearch,
  Hash,
  MapPin,
  Clock,
  Loader2,
  Search,
  ArrowRight,
  Package,
  Truck,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
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
  {
    icon: Package,
    label: "Processing",
    detail: "Order received and prepared",
  },
  {
    icon: Truck,
    label: "In transit",
    detail: "Handed to our courier",
  },
  {
    icon: CheckCircle2,
    label: "Delivered",
    detail: "Arrives at your address",
  },
];

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
      <>
        <section className="relative overflow-hidden bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))] pt-36 md:pt-44 pb-16 md:pb-20">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 right-[-8%] h-104 w-104 rounded-full bg-primary/20 blur-3xl"
          />
          <div className="relative max-w-300 mx-auto px-6 lg:px-20 space-y-8">
            <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-bold text-white/40">
              <Link href="/" className="hover:text-primary transition-colors">
                Home
              </Link>
              <ChevronRight className="w-3 h-3" />
              <button
                type="button"
                onClick={handleReset}
                className="hover:text-primary transition-colors"
              >
                Track Order
              </button>
              <ChevronRight className="w-3 h-3" />
              <span className="text-primary">#{order.orderNumber}</span>
            </nav>

            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-8">
              <div className="space-y-4 max-w-2xl">
                <p className="text-[10px] uppercase tracking-[0.4em] font-bold text-primary">
                  Live status
                </p>
                <h1 className="font-serif text-4xl md:text-5xl tracking-[0.08em] uppercase text-white">
                  Order #{order.orderNumber}
                </h1>
                {order.shopifyOrderName &&
                  order.shopifyOrderName !== order.orderNumber && (
                    <p className="text-white/55 text-sm">
                      Also shown as{" "}
                      <span className="text-white/80 font-medium">
                        {order.shopifyOrderName}
                      </span>{" "}
                      on your payment confirmation
                    </p>
                  )}
                <p className="text-white/55 text-sm">
                  Placed{" "}
                  {new Date(order.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="md:text-right space-y-2">
                <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/40">
                  Current status
                </p>
                <p className="font-serif text-2xl md:text-3xl tracking-[0.06em] text-primary">
                  {order.status}
                </p>
                <p className="text-[10px] uppercase tracking-widest font-bold text-white/45">
                  Payment · {order.paymentStatus}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 md:py-24 px-6 lg:px-20 bg-background">
          <div className="max-w-300 mx-auto grid grid-cols-1 lg:grid-cols-12 gap-14 lg:gap-16">
            <div className="lg:col-span-7 space-y-10">
              <div>
                <p className="text-[10px] uppercase tracking-[0.35em] font-bold text-primary mb-3">
                  Journey
                </p>
                <h2 className="font-serif text-2xl md:text-3xl tracking-[0.08em] uppercase text-foreground">
                  Delivery timeline
                </h2>
              </div>

              <div className="relative space-y-0 before:absolute before:left-4.75 before:top-3 before:bottom-3 before:w-px before:bg-foreground/10">
                {steps.map((step) => {
                  const Icon = step.icon;
                  const active = step.completed || step.current;
                  return (
                    <div key={step.status} className="relative flex gap-7 py-5">
                      <div
                        className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                          step.completed
                            ? "bg-primary border-primary text-primary-foreground"
                            : step.current
                              ? "bg-background border-primary text-primary scale-110"
                              : "bg-background border-foreground/15 text-foreground/25"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 pt-1.5 space-y-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3
                            className={`text-[11px] uppercase tracking-widest font-bold ${
                              active ? "text-primary" : "opacity-40"
                            }`}
                          >
                            {step.status}
                          </h3>
                          <p
                            className={`text-[10px] font-bold uppercase tracking-widest ${
                              active ? "text-primary/80" : "opacity-40"
                            }`}
                          >
                            {step.date}
                          </p>
                        </div>
                        <p
                          className={`text-sm leading-relaxed ${
                            active ? "text-muted-foreground" : "opacity-40"
                          }`}
                        >
                          {step.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-5 space-y-6">
              <div className="bg-secondary/40 border border-foreground/5 p-8 md:p-10 space-y-8">
                <div className="space-y-4">
                  <h4 className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
                    Delivery address
                  </h4>
                  <div className="flex gap-4">
                    <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-sm leading-relaxed text-muted-foreground">
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
                  </div>
                </div>

                <div className="pt-6 border-t border-foreground/10 space-y-4">
                  <h4 className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
                    Items in shipment
                  </h4>
                  <div className="space-y-4">
                    {order.items.map((item, i) => (
                      <div key={i} className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-secondary overflow-hidden shrink-0">
                          {item.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold uppercase tracking-tight truncate">
                            {item.name}
                          </p>
                          <p className="text-[10px] text-primary font-bold mt-1">
                            Qty {item.quantity} · £
                            {Number(item.price).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-foreground/10 space-y-3">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Subtotal</span>
                    <span>£{order.subtotal.toFixed(2)}</span>
                  </div>
                  {order.discountAmount > 0 && (
                    <div className="flex justify-between text-xs text-green-700 font-bold">
                      <span>
                        Discount
                        {order.couponCode ? ` (${order.couponCode})` : ""}
                      </span>
                      <span>-£{order.discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="pt-3 border-t border-foreground/10 flex justify-between items-baseline">
                    <span className="text-xs uppercase tracking-widest font-bold text-primary">
                      Total
                    </span>
                    <span className="text-3xl font-serif text-foreground">
                      £{Number(order.totalAmount).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border border-foreground/10 p-8 space-y-4">
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-primary" />
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
                    Need help?
                  </p>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Questions about this delivery? Our team can help.
                </p>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-bold text-primary hover:text-foreground transition-colors"
                >
                  Contact us
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="w-full py-4 border border-foreground/15 text-[10px] uppercase tracking-[0.3em] font-bold hover:border-primary hover:text-primary transition-colors"
              >
                Track another order
              </button>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <section className="relative overflow-hidden bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))] min-h-[calc(100vh-4rem)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 right-[-10%] h-128 w-lg rounded-full bg-primary/18 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-10%] left-[-8%] h-104 w-104 rounded-full bg-white/4 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative max-w-350 mx-auto px-6 lg:px-20 pt-36 md:pt-44 pb-20 md:pb-28">
        <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-bold text-white/40 mb-12 md:mb-16">
          <Link href="/" className="hover:text-primary transition-colors">
            Home
          </Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-primary">Track Order</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-14 lg:gap-16 xl:gap-20 items-start">
          <div className="lg:col-span-5 xl:col-span-5 space-y-10 lg:sticky lg:top-36">
            <div className="space-y-5">
              <p className="text-[10px] uppercase tracking-[0.4em] font-bold text-primary">
                Client service
              </p>
              <BrandLogo variant="light" size="md" className="text-white/90" />
              <h1 className="font-serif text-4xl md:text-5xl xl:text-6xl tracking-[0.08em] uppercase text-white leading-tight">
                Track Order
              </h1>
              <p className="text-white/55 text-sm md:text-base leading-relaxed max-w-md">
                Follow your materials from warehouse to door — enter the order
                ID from your confirmation email.
              </p>
            </div>

            <div className="space-y-0 border-t border-white/10">
              {JOURNEY.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.label}
                    className="flex gap-5 py-5 border-b border-white/10"
                  >
                    <div className="flex items-center justify-center w-10 h-10 border border-white/15 text-primary shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="space-y-1 pt-0.5">
                      <div className="flex items-baseline gap-3">
                        <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/30">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <p className="font-serif text-lg tracking-[0.08em] uppercase text-white">
                          {step.label}
                        </p>
                      </div>
                      <p className="text-xs text-white/45 tracking-wide">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-start gap-3 text-white/40">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                Keep your order ID private — anyone with it can view this
                shipment status.
              </p>
            </div>
          </div>

          <div className="lg:col-span-7 xl:col-span-7">
            <form
              onSubmit={handleSubmit}
              className="relative bg-white text-foreground p-8 md:p-12 lg:p-14 space-y-8 shadow-2xl shadow-black/30"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <PackageSearch className="w-5 h-5 text-primary" />
                  <p className="text-[10px] uppercase tracking-[0.35em] font-bold text-primary">
                    Enter your details
                  </p>
                </div>
                <h2 className="font-serif text-2xl md:text-3xl tracking-[0.08em] uppercase">
                  Find your shipment
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Use the order ID from your confirmation email to check live
                  status.
                </p>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
                    Order ID
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
                    <input
                      type="text"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      placeholder="e.g. LINX-AB12-1234 or #1001"
                      className="w-full pl-12 pr-4 py-4 bg-secondary/50 text-sm outline-none transition-all focus:bg-white border border-foreground/45 hover:border-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/25"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>

              {error ? (
                <p className="text-[10px] uppercase tracking-widest font-bold text-red-500">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-3 px-12 py-5 bg-primary text-primary-foreground uppercase tracking-[0.25em] text-[10px] font-bold hover:bg-black hover:text-white transition-all disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Searching…
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Track order
                  </>
                )}
              </button>

              <p className="text-center text-[11px] text-muted-foreground">
                Need help?{" "}
                <Link
                  href="/contact"
                  className="text-primary font-bold uppercase tracking-widest text-[10px] hover:text-foreground transition-colors"
                >
                  Contact us
                </Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

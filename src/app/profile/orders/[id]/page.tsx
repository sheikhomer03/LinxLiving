"use client";

import React, { use } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import {
  Package,
  Truck,
  CheckCircle2,
  MapPin,
  Clock,
  Box,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { useSingleOrder } from "@/hooks/useRealtimeOrders";

export default function OrderTrackingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { order, loading, error } = useSingleOrder(id, 10000);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#333]/20 border-t-[#333] animate-spin rounded-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-4">
        <h1 className="text-2xl font-serif uppercase tracking-widest text-[#333]">
          Order Not Found
        </h1>
        <Link
          href="/profile"
          className="text-xs uppercase tracking-widest font-bold underline"
        >
          Back to Orders
        </Link>
      </div>
    );
  }

  const TRACKING_STEPS = [
    {
      status: "Ordered",
      date: new Date(order.createdAt).toLocaleString(),
      description:
        "Your order has been received and is being processed by our artisans.",
      icon: Package,
      completed: true,
    },
    {
      status: "Processed",
      date: order.paymentStatus === "Paid" ? "Verified" : "Pending",
      description: "Quality control and hallmark verification completed.",
      icon: Box,
      completed: order.paymentStatus === "Paid",
      current: order.paymentStatus !== "Paid",
    },
    {
      status: "Shipped",
      date:
        order.status === "Shipped" || order.status === "Delivered"
          ? "In Transit"
          : "Pending",
      description: "Handed over to our premium courier service.",
      icon: Truck,
      completed: order.status === "Shipped" || order.status === "Delivered",
      current: order.status === "Shipped",
    },
    {
      status: "Delivered",
      date:
        order.status === "Delivered"
          ? new Date().toLocaleDateString()
          : "Pending",
      description: "Your collection has arrived at your designated address.",
      icon: CheckCircle2,
      completed: order.status === "Delivered",
      current: order.status === "Delivered",
    },
  ];

  return (
    <main className="min-h-screen bg-white flex flex-col">
      <Navbar />

      <section className="flex-1 pt-52 pb-24 px-6 lg:px-20 max-w-5xl mx-auto w-full">
        {/* Back Link */}
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity mb-12"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Orders
        </Link>

        <div className="space-y-16">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-foreground/5 pb-12">
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-[0.4em] font-bold opacity-40">
                Track Acquisition
              </p>
              <h1 className="text-4xl md:text-5xl font-serif tracking-tight uppercase">
                Order #{order.orderNumber}
              </h1>
            </div>
            <div className="text-right space-y-2">
              <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">
                Estimated Delivery
              </p>
              <p className="text-xl font-serif">
                {order.status === "Delivered" ? "Delivered" : "Coming Soon"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-20">
            {/* Left: Timeline */}
            <div className="lg:col-span-7 space-y-12">
              <div className="relative space-y-12 before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-px before:bg-foreground/5">
                {TRACKING_STEPS.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div key={index} className="relative flex gap-8 group">
                      <div
                        className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-500
                          ${
                            step.completed
                              ? "bg-[#333] border-[#333] text-white"
                              : step.current
                                ? "bg-white border-[#333] text-[#333] shadow-xl shadow-black/10 scale-110"
                                : "bg-white border-foreground/5 text-foreground/20"
                          }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>

                      <div className="flex-1 pt-1 space-y-2">
                        <div className="flex justify-between items-baseline">
                          <h3
                            className={`text-[11px] uppercase tracking-widest font-bold ${!step.completed && !step.current ? "opacity-30" : ""}`}
                          >
                            {step.status}
                          </h3>
                          <p className="text-[10px] font-sans opacity-40">
                            {step.date}
                          </p>
                        </div>
                        <p
                          className={`text-sm font-sans leading-relaxed ${!step.completed && !step.current ? "opacity-20" : "opacity-60"}`}
                        >
                          {step.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Summary Box */}
            <div className="lg:col-span-5 space-y-8">
              <div className="bg-secondary/20 border border-foreground/5 p-10 space-y-8">
                <div className="space-y-4">
                  <h4 className="text-[10px] uppercase tracking-widest font-bold opacity-40">
                    Shipment Details
                  </h4>
                  <div className="space-y-6">
                    <div className="flex gap-4">
                      <MapPin className="w-4 h-4 opacity-40" />
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold uppercase tracking-tight">
                          Delivery Address
                        </p>
                        <p className="text-sm font-sans opacity-60 leading-relaxed">
                          {order.shippingAddress.firstName}{" "}
                          {order.shippingAddress.lastName}
                          <br />
                          {order.shippingAddress.address}
                          <br />
                          {order.shippingAddress.city},{" "}
                          {order.shippingAddress.postcode}
                          <br />
                          {order.shippingAddress.country}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <Clock className="w-4 h-4 opacity-40" />
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold uppercase tracking-tight">
                          Shipping Service
                        </p>
                        <p className="text-sm font-sans opacity-60">
                          Express Platinum Courier
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-8 border-t border-foreground/5 space-y-6">
                  <h4 className="text-[10px] uppercase tracking-widest font-bold opacity-40">
                    Items in Shipment
                  </h4>
                  <div className="space-y-4">
                    {order.items.map((item: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between group cursor-pointer"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-white border border-foreground/5 flex items-center justify-center p-2">
                            <img
                              src={item.image}
                              alt={item.name}
                              className="w-full h-full object-cover grayscale"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-xs font-bold uppercase tracking-tight">
                              {item.name}
                            </p>
                            <p className="text-[10px] opacity-40 font-sans">
                              Quantity: {item.quantity}
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-all -translate-x-2 group-hover:translate-x-0" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Support Box */}
              <div className="p-10 border border-[#333]/10 space-y-4">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[#333]">
                  Need Assistance?
                </p>
                <p className="text-xs font-sans opacity-60 leading-relaxed">
                  Our concierge team is available 24/7 for any enquiries
                  regarding your delivery.
                </p>
                <button className="text-[10px] uppercase tracking-widest font-bold underline underline-offset-4 hover:opacity-60 transition-opacity">
                  Contact Concierge
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

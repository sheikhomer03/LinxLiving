"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Printer,
  Package,
  Truck,
  Clock,
  CheckCircle2,
  Mail,
  MapPin,
  CreditCard,
  Box,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

import { useSingleOrder } from "@/hooks/useRealtimeOrders";

export default function OrderDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { order, loading, error } = useSingleOrder(id);
  const [isUpdating, setIsUpdating] = useState(false);

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
          href="/admin/orders"
          className="text-xs uppercase tracking-widest font-bold underline"
        >
          Back to Orders
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-4">
          <Link
            href="/admin/orders"
            className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back to Orders
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <h1 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
              Order #{order.orderNumber}
            </h1>
            <div className="relative group/status">
              <select
                value={order.status}
                disabled={isUpdating}
                onChange={async (e) => {
                  const newStatus = e.target.value;
                  setIsUpdating(true);
                  try {
                    const updatePromise = fetch(`/api/orders/${order._id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: newStatus }),
                    }).then(async (res) => {
                      if (!res.ok) {
                        const errorData = await res.json().catch(() => ({}));
                        throw new Error(
                          errorData.error || "Failed to update status",
                        );
                      }
                      return res.json();
                    });

                    toast.promise(updatePromise, {
                      loading: "Updating order status...",
                      success: `Order status updated to ${newStatus}`,
                      error: (err) => `Failed: ${err.message}`,
                    });

                    await updatePromise;
                  } catch (err) {
                    console.error("Status Update Error:", err);
                  } finally {
                    setIsUpdating(false);
                  }
                }}
                className={cn(
                  "appearance-none text-[10px] px-8 py-2 border font-bold uppercase tracking-widest cursor-pointer outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                  order.status === "Pending" || order.status === "Processing"
                    ? "bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100"
                    : order.status === "Shipped"
                      ? "bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100"
                      : order.status === "Delivered"
                        ? "bg-green-50 text-green-700 border-green-100 hover:bg-green-100"
                        : "bg-red-50 text-red-700 border-red-100 hover:bg-red-100",
                )}
              >
                <option value="Pending">Pending</option>
                <option value="Processing">Processing</option>
                <option value="Shipped">Shipped</option>
                <option value="Out for Delivery">Out for Delivery</option>
                <option value="Delivered">Delivered</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity">
                {isUpdating ? (
                  <div className="w-3 h-3 border-2 border-[#333]/20 border-t-[#333] rounded-full animate-spin" />
                ) : (
                  <ChevronLeft className="w-3 h-3 -rotate-90 opacity-50" />
                )}
              </div>
            </div>
          </div>
        </div>
        <button className="border border-[#333]/20 px-8 py-4 uppercase tracking-[0.2em] text-[10px] font-bold hover:bg-[#333] hover:text-white transition-all flex items-center gap-3">
          <Printer className="w-4 h-4" />
          Print Invoice
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Main Content: Items & Timeline */}
        <div className="lg:col-span-2 space-y-10">
          {/* Order Items */}
          <div className="bg-white border border-[#333]/5 overflow-hidden">
            <div className="p-8 border-b border-[#333]/5">
              <h2 className="text-xl font-serif uppercase tracking-widest text-[#333]">
                Order Pieces
              </h2>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-secondary/10 border-b border-[#333]/5">
                  <th className="px-8 py-4 text-[9px] uppercase tracking-[0.2em] font-bold opacity-40">
                    Piece
                  </th>
                  <th className="px-8 py-4 text-[9px] uppercase tracking-[0.2em] font-bold opacity-40 text-center">
                    Qty
                  </th>
                  <th className="px-8 py-4 text-[9px] uppercase tracking-[0.2em] font-bold opacity-40 text-right">
                    Price
                  </th>
                  <th className="px-8 py-4 text-[9px] uppercase tracking-[0.2em] font-bold opacity-40 text-right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#333]/5">
                {order.items.map((item, i) => (
                  <tr
                    key={i}
                    className="hover:bg-secondary/5 transition-colors"
                  >
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <div className="relative w-12 h-12 bg-secondary/50 border border-[#333]/5">
                          <Image
                            src={item.image}
                            alt={item.name}
                            fill
                            className="object-cover grayscale"
                          />
                        </div>
                        <span className="text-[10px] uppercase tracking-widest font-bold text-[#333]">
                          {item.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-center font-serif text-sm">
                      {item.quantity}
                    </td>
                    <td className="px-8 py-5 text-right font-serif text-sm">
                      £{item.price.toFixed(2)}
                    </td>
                    <td className="px-8 py-5 text-right font-serif text-sm font-bold">
                      £{(item.price * item.quantity).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Total Summary */}
            <div className="p-10 bg-secondary/10 flex justify-end">
              <div className="w-72 space-y-4">
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-40">
                  <span>Subtotal</span>
                  <span>£{order.totalAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-40">
                  <span>Shipping</span>
                  <span>£0.00</span>
                </div>
                <div className="pt-4 border-t border-[#333]/10 flex justify-between">
                  <span className="text-xs uppercase tracking-[0.2em] font-black text-[#333]">
                    Total Due
                  </span>
                  <span className="text-xl font-serif text-[#333]">
                    £{order.totalAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Logistics Tracking (Timeline) */}
          <div className="bg-white border border-[#333]/5 p-8 space-y-8">
            <h3 className="text-sm font-bold uppercase tracking-widest text-[#333] flex items-center gap-3">
              <Truck className="w-4 h-4" />
              Logistics Journey
            </h3>
            <div className="space-y-8">
              {[
                {
                  label: "Order Placed",
                  date: new Date(order.createdAt).toLocaleString(),
                  status: "complete",
                  icon: CheckCircle2,
                },
                {
                  label: "Payment Verified",
                  date: order.paymentStatus === "Paid" ? "Verified" : "Pending",
                  status:
                    order.paymentStatus === "Paid" ? "complete" : "current",
                  icon: CreditCard,
                },
                {
                  label: "Preparing Pieces",
                  date:
                    order.status === "Pending" || order.status === "Processing"
                      ? "In Progress"
                      : order.status === "Shipped" ||
                          order.status === "Delivered"
                        ? "Completed"
                        : "Pending",
                  status:
                    order.status === "Pending" || order.status === "Processing"
                      ? "current"
                      : order.status === "Shipped" ||
                          order.status === "Delivered"
                        ? "complete"
                        : "pending",
                  icon: Box,
                },
                {
                  label: "Out for Delivery",
                  date:
                    order.status === "Shipped"
                      ? "In Transit"
                      : order.status === "Delivered"
                        ? "Arrived"
                        : "Pending",
                  status:
                    order.status === "Shipped"
                      ? "current"
                      : order.status === "Delivered"
                        ? "complete"
                        : "pending",
                  icon: Truck,
                },
              ].map((step, i) => (
                <div key={i} className="flex gap-6 relative group">
                  {i !== 3 && (
                    <div className="absolute left-[11px] top-6 w-px h-10 bg-[#333]/5" />
                  )}
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10",
                      step.status === "complete"
                        ? "bg-green-50"
                        : step.status === "current"
                          ? "bg-amber-50"
                          : "bg-secondary/50",
                    )}
                  >
                    <step.icon
                      className={cn(
                        "w-3.5 h-3.5",
                        step.status === "complete"
                          ? "text-green-600"
                          : step.status === "current"
                            ? "text-amber-600"
                            : "text-[#333]/20",
                      )}
                    />
                  </div>
                  <div>
                    <p
                      className={cn(
                        "text-[10px] uppercase tracking-widest font-black",
                        step.status === "pending"
                          ? "opacity-20"
                          : "text-[#333]",
                      )}
                    >
                      {step.label}
                    </p>
                    <p className="text-[9px] uppercase tracking-[0.2em] font-bold opacity-40 mt-1">
                      {step.date}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar: Customer & Payment */}
        <div className="space-y-10">
          {/* Customer Details */}
          <div className="bg-white border border-[#333]/5 p-8 space-y-8">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-black text-[#333] opacity-40 pb-4 border-b border-[#333]/5">
              Customer Info
            </h3>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#333] text-white flex items-center justify-center font-serif text-xl">
                  {order.shippingAddress.firstName[0]}
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-[#333]">
                    {order.shippingAddress.firstName}{" "}
                    {order.shippingAddress.lastName}
                  </p>
                  <p className="text-[9px] opacity-40 uppercase tracking-widest mt-1">
                    Customer Details
                  </p>
                </div>
              </div>
              <div className="space-y-4 pt-4">
                <div className="flex items-start gap-4">
                  <Mail className="w-4 h-4 opacity-20 mt-0.5" />
                  <span className="text-[10px] font-bold text-[#333]">
                    {order.shippingAddress.email || "Email Not Provided"}
                  </span>
                </div>
                <div className="flex items-start gap-4">
                  <MapPin className="w-4 h-4 opacity-20 mt-0.5" />
                  <div className="text-[10px] font-bold text-[#333] leading-relaxed">
                    {order.shippingAddress.address}
                    <br />
                    {order.shippingAddress.city},{" "}
                    {order.shippingAddress.postcode}
                    <br />
                    {order.shippingAddress.country}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Method */}
          <div className="bg-white border border-[#333]/5 p-8 space-y-8">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-black text-[#333] opacity-40 pb-4 border-b border-[#333]/5">
              Payment & Bond
            </h3>
            <div className="flex items-center gap-4">
              <div className="p-3 bg-secondary/50">
                <CreditCard className="w-5 h-5 text-[#333]/40" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-black text-[#333]">
                  {order.paymentMethod}
                </p>
                <p
                  className={`text-[9px] uppercase tracking-widest font-bold mt-1 ${order.paymentStatus === "Paid" ? "text-green-600" : "text-amber-600"}`}
                >
                  {order.paymentStatus === "Paid"
                    ? "Captured Successfully"
                    : "Payment Pending"}
                </p>
              </div>
            </div>
          </div>

          {/* Admin Notes */}
          <div className="bg-white border border-[#333]/5 p-8 space-y-6">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-black text-[#333] opacity-40">
              Curation Notes
            </h3>
            <textarea
              placeholder="ADD A NOTE FOR YOUR TEAM..."
              className="w-full bg-secondary/10 border-none p-6 text-[10px] uppercase tracking-widest font-bold min-h-[120px] outline-none focus:bg-white focus:ring-1 focus:ring-[#333]/10 transition-all"
            />
            <button className="w-full bg-[#333] text-white py-4 text-[9px] uppercase tracking-[0.2em] font-bold hover:bg-black transition-all">
              Save Note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper for conditional classes
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

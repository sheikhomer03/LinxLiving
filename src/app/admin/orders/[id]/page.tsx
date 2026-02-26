"use client";

import React from "react";
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
} from "lucide-react";
import Image from "next/image";

export default function OrderDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const orderId = `#AUR-${params.id}`;

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
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
              Order {orderId}
            </h1>
            <span className="bg-amber-50 text-amber-700 text-[10px] px-3 py-1 border border-amber-100 font-bold uppercase tracking-widest">
              Getting Ready
            </span>
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
                {[
                  {
                    name: "Celestial Alabaster Tiles",
                    qty: 24,
                    price: "£45.00",
                    total: "£1,080.00",
                    image:
                      "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=200",
                  },
                  {
                    name: "Golden Vein Marble Trim",
                    qty: 4,
                    price: "£92.50",
                    total: "£370.00",
                    image:
                      "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=200",
                  },
                ].map((item, i) => (
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
                      {item.qty}
                    </td>
                    <td className="px-8 py-5 text-right font-serif text-sm">
                      {item.price}
                    </td>
                    <td className="px-8 py-5 text-right font-serif text-sm font-bold">
                      {item.total}
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
                  <span>£1,450.00</span>
                </div>
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-40">
                  <span>Shipping</span>
                  <span>£0.00</span>
                </div>
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-40">
                  <span>Tax (VAT 20%)</span>
                  <span>£290.00</span>
                </div>
                <div className="pt-4 border-t border-[#333]/10 flex justify-between">
                  <span className="text-xs uppercase tracking-[0.2em] font-black text-[#333]">
                    Total Due
                  </span>
                  <span className="text-xl font-serif text-[#333]">
                    £1,740.00
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
                  date: "Feb 24, 09:12 AM",
                  status: "complete",
                  icon: CheckCircle2,
                },
                {
                  label: "Bond Verified",
                  date: "Feb 24, 10:30 AM",
                  status: "complete",
                  icon: CheckCircle2,
                },
                {
                  label: "Preparing Pieces",
                  date: "In Progress",
                  status: "current",
                  icon: Clock,
                },
                {
                  label: "Out for Delivery",
                  date: "Pending",
                  status: "pending",
                  icon: Package,
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
                  J
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-[#333]">
                    Julianne Moore
                  </p>
                  <p className="text-[9px] opacity-40 lowercase tracking-widest mt-1">
                    24 Past Purchases
                  </p>
                </div>
              </div>
              <div className="space-y-4 pt-4">
                <div className="flex items-start gap-4">
                  <Mail className="w-4 h-4 opacity-20 mt-0.5" />
                  <span className="text-[10px] font-bold text-[#333]">
                    julianne.m@example.com
                  </span>
                </div>
                <div className="flex items-start gap-4">
                  <MapPin className="w-4 h-4 opacity-20 mt-0.5" />
                  <div className="text-[10px] font-bold text-[#333] leading-relaxed">
                    124 Celestial Mews
                    <br />
                    Mayfair, London
                    <br />
                    W1K 4QT, UK
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
                  Visa ending in 4242
                </p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-green-600 mt-1">
                  Captured Successfully
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

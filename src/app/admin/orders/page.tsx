"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Search,
  Filter,
  Eye,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  Download,
} from "lucide-react";

const DUMMY_ORDERS = [
  {
    orderId: "#AUR-2045",
    customer: "Julianne Moore",
    date: "Feb 24, 2026",
    amount: "£1,450.00",
    status: "Processing",
    items: 4,
    payment: "Visa ending in 4242",
  },
  {
    orderId: "#AUR-2044",
    customer: "Sebastian Vanc",
    date: "Feb 23, 2026",
    amount: "£890.00",
    status: "Shipped",
    items: 2,
    payment: "Apple Pay",
  },
  {
    orderId: "#AUR-2043",
    customer: "Elena Rigby",
    date: "Feb 22, 2026",
    amount: "£2,100.00",
    status: "Delivered",
    items: 6,
    payment: "Bank Transfer",
  },
  {
    orderId: "#AUR-2042",
    customer: "Marc Aurelius",
    date: "Feb 21, 2026",
    amount: "£540.00",
    status: "Cancelled",
    items: 1,
    payment: "Mastercard",
  },
];

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState("All Orders");

  const filteredOrders = DUMMY_ORDERS.filter((order) => {
    if (activeTab === "All Orders") return true;
    if (activeTab === "Getting Ready") return order.status === "Processing";
    if (activeTab === "On the Way") return order.status === "Shipped";
    if (activeTab === "Arrived") return order.status === "Delivered";
    return true;
  });

  return (
    <div className="space-y-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
            Orders
          </h1>
          <p className="text-[11px] uppercase tracking-widest font-bold opacity-40">
            Recent sales and fulfillment tracking
          </p>
        </div>
        <button
          disabled
          className="border border-[#333]/10 px-8 py-4 uppercase tracking-[0.2em] text-[10px] font-bold opacity-40 cursor-not-allowed flex items-center gap-3"
          title="Download temporarily disabled"
        >
          <Download className="w-4 h-4" />
          Download Report
        </button>
      </header>

      {/* Tabs / Status Quick Filter */}
      <div className="flex gap-10 border-b border-[#333]/5 pb-1">
        {["All Orders", "Getting Ready", "On the Way", "Arrived"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-[9px] uppercase tracking-[0.3em] font-bold pb-4 transition-all relative ${
              activeTab === tab
                ? "text-[#333] after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-px after:bg-[#333]"
                : "text-[#333]/30 hover:text-[#333]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-[#333]/5 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-secondary/30 border-b border-[#333]/5">
              <th className="px-8 py-5 text-[10px] uppercase tracking-widest font-bold opacity-40">
                Order ID
              </th>
              <th className="px-8 py-5 text-[10px] uppercase tracking-widest font-bold opacity-40">
                Customer
              </th>
              <th className="px-8 py-5 text-[10px] uppercase tracking-widest font-bold opacity-40">
                Date
              </th>
              <th className="px-8 py-5 text-[10px] uppercase tracking-widest font-bold opacity-40">
                Amount
              </th>
              <th className="px-8 py-5 text-[10px] uppercase tracking-widest font-bold opacity-40">
                Status
              </th>
              <th className="px-8 py-5 text-[10px] uppercase tracking-widest font-bold opacity-40 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#333]/5">
            {filteredOrders.map((order) => (
              <tr
                key={order.orderId}
                className="group hover:bg-secondary/10 transition-colors"
              >
                <td className="px-8 py-6 font-bold text-xs tracking-widest text-[#333]">
                  {order.orderId}
                </td>
                <td className="px-8 py-6">
                  <p className="text-[11px] uppercase tracking-widest font-bold text-[#333]">
                    {order.customer}
                  </p>
                </td>
                <td className="px-8 py-6 text-[10px] opacity-40 uppercase tracking-widest font-bold">
                  {order.date}
                </td>
                <td className="px-8 py-6 font-serif text-sm text-[#333]">
                  {order.amount}
                </td>
                <td className="px-8 py-6">
                  <div className="flex items-center gap-2">
                    {order.status === "Processing" && (
                      <Clock className="w-3 h-3 text-amber-500" />
                    )}
                    {order.status === "Shipped" && (
                      <Truck className="w-3 h-3 text-blue-500" />
                    )}
                    {order.status === "Delivered" && (
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                    )}
                    {order.status === "Cancelled" && (
                      <XCircle className="w-3 h-3 text-red-500" />
                    )}
                    <span className="text-[9px] uppercase tracking-widest font-bold opacity-60">
                      {order.status === "Processing"
                        ? "Getting Ready"
                        : order.status === "Shipped"
                          ? "On the Way"
                          : order.status === "Delivered"
                            ? "Arrived"
                            : "Cancelled"}
                    </span>
                  </div>
                </td>
                <td className="px-8 py-6 text-right">
                  <Link
                    href={`/admin/orders/${order.orderId.replace("#", "")}`}
                    className="inline-block px-4 py-2 border border-[#333]/5 group-hover:border-[#333]/20 text-[9px] uppercase tracking-[0.2em] font-bold hover:bg-[#333] hover:text-white transition-all"
                  >
                    Details
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

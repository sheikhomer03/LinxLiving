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
  ChevronDown,
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState("All Orders");
  const [searchQuery, setSearchQuery] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const { orders, loading, error } = useRealtimeOrders(10000);

  const filteredOrders = orders.filter((order) => {
    const matchesTab =
      activeTab === "All Orders" ||
      (activeTab === "Processing" && order.status === "Processing") ||
      (activeTab === "On the Way" && order.status === "Shipped") ||
      (activeTab === "Arrived" && order.status === "Delivered");

    if (!matchesTab) return false;

    // Search Filter
    if (!searchQuery) return true;

    const searchLower = searchQuery.toLowerCase();
    const fullName =
      `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`.toLowerCase();
    const email = (order.shippingAddress.email || "").toLowerCase();
    const orderNum = order.orderNumber.toString().toLowerCase();

    return (
      fullName.includes(searchLower) ||
      email.includes(searchLower) ||
      orderNum.includes(searchLower)
    );
  });

  if (loading && orders.length === 0) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12 animate-in fade-in duration-1000">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-8">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold">
            Orders
          </h1>
        </div>
      </header>
      <div className="overflow-x-auto pt-5 custom-scrollbar -mx-6 px-6 sm:mx-0 sm:px-0">
        <div className="flex gap-8 lg:gap-10 border-b border-[#333]/5 pb-1 mb-5 min-w-max">
          {[
            "All Orders",
            "Processing",
            "Shipped",
            "Out for Delivery",
            "Delivered",
            "Cancelled",
          ].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-[8px] lg:text-[13px] uppercase tracking-[0.4em] font-black pb-4 transition-all relative ${
                activeTab === tab
                  ? "text-primary after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-px after:bg-primary"
                  : "text-[#333]/30 hover:text-primary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Refined Minimalist Search Bar */}
      {/* Search Bar */}
      <div className="bg-white input-standard px-6 py-3 flex items-center gap-4 lg:gap-6 shadow-sm border border-[#333]/5 group transition-all duration-700 hover:shadow-md mb-5 lg:mb-12">
        <div className="shrink-0">
          <Search className="w-4 h-4 lg:w-5 h-5 text-primary group-focus-within:text-primary transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email or #ID..."
            className="w-full bg-transparent placeholder:text-[#333]/60 text-base lg:text-lg font-serif tracking-wide text-[#333] outline-none transition-all"
          />
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-[#1a1a1a] text-primary font-black text-[11px] lg:text-[12px] uppercase tracking-[0.2em]">
                <th className="px-6 lg:px-10 py-5">Order ID</th>
                <th className="px-6 lg:px-10 py-5">Customer</th>
                <th className="px-6 lg:px-10 py-5">Date</th>
                <th className="px-6 lg:px-10 py-5">Amount</th>
                <th className="px-6 lg:px-10 py-5">Status</th>
                <th className="px-6 lg:px-10 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333]/10">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-20 lg:py-32 text-center text-[#333]"
                  >
                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="w-20 h-20 bg-primary/5 flex items-center justify-center rounded-full border border-primary/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                        <ShoppingBag className="w-10 h-10 text-primary/60" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-serif font-bold text-primary">
                          No Orders Found
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.2em] font-black text-primary/60">
                          {activeTab !== "All Orders"
                            ? `There are no orders in the "${activeTab}" status`
                            : "You haven't received any orders yet"}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr
                    key={order._id}
                    className="group hover:bg-secondary/5 transition-all duration-500"
                  >
                    <td className="px-6 lg:px-10 py-6 lg:py-8 font-bold text-[11px] lg:text-xs tracking-widest text-[#333]">
                      #{order.orderNumber}
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8">
                      <p className="text-[10px] lg:text-[11px] uppercase tracking-widest font-bold text-[#333]">
                        {order.shippingAddress.firstName}{" "}
                        {order.shippingAddress.lastName}
                      </p>
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 text-[9px] lg:text-[10px] opacity-80 uppercase tracking-widest font-bold">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 font-serif text-sm text-[#333]">
                      £{order.totalAmount.toFixed(2)}
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 relative">
                      <div className="flex items-center gap-2 relative">
                        <select
                          value={order.status}
                          disabled={updatingOrderId === order._id}
                          onChange={async (e) => {
                            const newStatus = e.target.value;
                            setUpdatingOrderId(order._id as string);
                            try {
                              const updatePromise = fetch(
                                `/api/orders/${order._id}`,
                                {
                                  method: "PATCH",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({ status: newStatus }),
                                },
                              ).then(async (res) => {
                                if (!res.ok) {
                                  const errorData = await res
                                    .json()
                                    .catch(() => ({}));
                                  throw new Error(
                                    errorData.error ||
                                      "Failed to update status",
                                  );
                                }
                                return res.json();
                              });

                              toast.promise(updatePromise, {
                                loading: `Updating order #${order.orderNumber}...`,
                                success: `Order #${order.orderNumber} status updated to ${newStatus}`,
                                error: (err) => `Failed: ${err.message}`,
                              });

                              await updatePromise;
                            } catch (err) {
                              console.error("Status Update Error:", err);
                            } finally {
                              setUpdatingOrderId(null);
                            }
                          }}
                          className={cn(
                            "appearance-none text-[8px] lg:text-[9px] px-3 py-1.5 border font-bold uppercase tracking-widest cursor-pointer outline-none transition-all disabled:opacity-90 disabled:cursor-not-allowed pr-8 relative z-10",
                            order.status === "Processing"
                              ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                              : order.status === "Shipped" ||
                                  order.status === "Out for Delivery"
                                ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                                : order.status === "Delivered"
                                  ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                  : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
                          )}
                        >
                          <option value="Processing">Processing</option>
                          <option value="Shipped">Shipped</option>
                          <option value="Out for Delivery">
                            Out for Delivery
                          </option>
                          <option value="Delivered">Delivered</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none z-20">
                          {updatingOrderId === order._id ? (
                            <div className="w-2.5 h-2.5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-primary/80" />
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 text-right">
                      <Link
                        href={`/admin/orders/${order._id}`}
                        className="inline-flex items-center px-4 lg:px-6 py-2.5 lg:py-3 bg-primary/5 hover:bg-primary text-primary hover:text-primary-foreground transition-all shadow-sm text-[9px] lg:text-[10px] uppercase tracking-widest font-bold border border-primary/10"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

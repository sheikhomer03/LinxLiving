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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState("All Orders");
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const { orders, loading, error } = useRealtimeOrders(10000); // Poll every 10 seconds

  const filteredOrders = orders.filter((order) => {
    if (activeTab === "All Orders") return true;
    if (activeTab === "Getting Ready")
      return order.status === "Pending" || order.status === "Processing";
    if (activeTab === "On the Way") return order.status === "Shipped";
    if (activeTab === "Arrived") return order.status === "Delivered";
    return true;
  });

  if (loading && orders.length === 0) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#333]/20 border-t-[#333] animate-spin rounded-full" />
      </div>
    );
  }

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
      <div className="bg-white border border-[#333]/5 overflow-x-auto custom-scrollbar">
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
                key={order._id}
                className="group hover:bg-secondary/10 transition-colors"
              >
                <td className="px-8 py-6 font-bold text-xs tracking-widest text-[#333]">
                  #{order.orderNumber}
                </td>
                <td className="px-8 py-6">
                  <p className="text-[11px] uppercase tracking-widest font-bold text-[#333]">
                    {order.shippingAddress.firstName}{" "}
                    {order.shippingAddress.lastName}
                  </p>
                </td>
                <td className="px-8 py-6 text-[10px] opacity-40 uppercase tracking-widest font-bold">
                  {new Date(order.createdAt).toLocaleDateString()}
                </td>
                <td className="px-8 py-6 font-serif text-sm text-[#333]">
                  £{order.totalAmount.toFixed(2)}
                </td>
                <td className="px-8 py-6 relative">
                  <div className="flex items-center gap-2 group/status relative">
                    {(order.status === "Pending" ||
                      order.status === "Processing") && (
                      <Clock className="w-3 h-3 text-amber-500" />
                    )}
                    {order.status === "Shipped" && (
                      <Truck className="w-3 h-3 text-blue-500" />
                    )}
                    {order.status === "Delivered" && (
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                    )}
                    {(order.status === "Cancelled" ||
                      order.status === "Returned") && (
                      <XCircle className="w-3 h-3 text-red-500" />
                    )}
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
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: newStatus }),
                            },
                          ).then(async (res) => {
                            if (!res.ok) {
                              const errorData = await res
                                .json()
                                .catch(() => ({}));
                              throw new Error(
                                errorData.error || "Failed to update status",
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
                        "appearance-none text-[9px] uppercase tracking-widest font-bold opacity-60 bg-transparent cursor-pointer hover:opacity-100 transition-opacity outline-none p-1 -ml-1 pr-6 relative z-10 disabled:opacity-30 disabled:cursor-not-allowed",
                      )}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Processing">Processing</option>
                      <option value="Shipped">Shipped</option>
                      <option value="Out for Delivery">Out for Delivery</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                    {updatingOrderId === order._id ? (
                      <div className="w-3 h-3 border-2 border-[#333]/20 border-t-[#333] rounded-full animate-spin absolute right-0 top-1/2 -translate-y-1/2" />
                    ) : (
                      <ChevronDown className="w-3 h-3 opacity-0 group-hover/status:opacity-40 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity" />
                    )}
                  </div>
                </td>
                <td className="px-8 py-6 text-right">
                  <Link
                    href={`/admin/orders/${order._id}`}
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

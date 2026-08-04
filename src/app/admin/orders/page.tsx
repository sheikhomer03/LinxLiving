"use client";

import React, { useEffect, useState } from "react";
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

import { Pagination } from "@/components/admin/Pagination";

export default function OrdersPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [activeTab, setActiveTab] = useState("All Orders");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch]);

  const { orders, totalPages, loading, error } = useRealtimeOrders(
    currentPage,
    itemsPerPage,
    10000,
    debouncedSearch,
  );

  const filteredOrders = orders.filter((order) => {
    const matchesTab =
      activeTab === "All Orders" ||
      (activeTab === "Processing" && order.status === "Processing") ||
      (activeTab === "On the Way" && order.status === "Shipped") ||
      (activeTab === "Arrived" && order.status === "Delivered");

    return matchesTab;
  });

  if (loading && orders.length === 0) {
    return (
      <div className="min-h-[240px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12 animate-in fade-in duration-300">
      <header className="admin-page-header">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary">
            Orders
          </h1>
        </div>
      </header>
      {/* <div className="overflow-x-auto pt-5 custom-scrollbar -mx-6 px-6 sm:mx-0 sm:px-0">
        <div className="flex gap-8 lg:gap-10 border-b border-stone-200/80 pb-1 mb-5 min-w-max">
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
              className={`text-[8px] lg:text-[13px] uppercase tracking-[0.18em] font-black pb-4 transition-all relative ${
                activeTab === tab
                  ? "text-primary after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-px after:bg-primary"
                  : "text-stone-400 hover:text-primary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div> */}

      {/* Refined Minimalist Search Bar */}
      {/* Search Bar */}
      <div className="admin-search flex items-center gap-3">
        <div className="shrink-0">
          <Search className="w-4 h-4 text-primary group-focus-within:text-primary transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email or #ID..."
            className="w-full bg-transparent placeholder:text-stone-400 text-sm text-stone-800 outline-none transition-all"
          />
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white admin-panel-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="admin-responsive-table w-full text-left border-collapse lg:min-w-[900px]">
            <thead>
              <tr className="admin-table-head font-semibold tracking-[0.12em]">
                <th className="px-4 py-2.5">Order ID</th>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Amount</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-stone-800"
                  >
                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="w-12 h-12 bg-primary/5 flex items-center justify-center rounded-full border border-primary/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                        <ShoppingBag className="w-5 h-5 text-primary/60" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-base font-serif font-bold text-primary">
                          No Orders Found
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.12em] font-black text-primary/60">
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
                    <td
                      data-label="Order ID"
                      className="px-4 py-3 font-bold text-[11px] lg:text-xs tracking-widest text-stone-800"
                    >
                      #{order.orderNumber}
                    </td>
                    <td data-label="Customer" className="px-4 py-3">
                      <p className="text-[10px] lg:text-[11px] uppercase tracking-widest font-bold text-stone-800">
                        {order.shippingAddress.firstName}{" "}
                        {order.shippingAddress.lastName}
                      </p>
                    </td>
                    <td
                      data-label="Date"
                      className="px-4 py-3 text-[9px] lg:text-[10px] opacity-80 uppercase tracking-widest font-bold"
                    >
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                    <td
                      data-label="Amount"
                      className="px-4 py-3 font-serif text-sm text-stone-800"
                    >
                      £{order.totalAmount.toFixed(2)}
                    </td>
                    <td data-label="Status" className="px-4 py-3 relative">
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
                              : order.status === "Confirmed Order"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                              : order.status === "Shipped" ||
                                  order.status === "Out for Delivery"
                                ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                                : order.status === "Delivered"
                                  ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                  : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
                          )}
                        >
                          <option value="Processing">Processing</option>
                          <option value="Confirmed Order">Confirmed Order</option>
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
                    <td data-label="Actions" className="px-4 py-3 text-right">
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
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          className="border-t border-stone-200/80 px-4"
        />
      </div>
    </div>
  );
}

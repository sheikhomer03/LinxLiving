"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  TrendingUp,
  ShoppingBag,
  Users,
  ArrowUpRight,
  Package,
  Mail,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import React, { useState } from "react";

import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { useRealtimeStats } from "@/hooks/useRealtimeStats";

export default function AdminDashboard() {
  const { data: session } = useSession();
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const { orders, loading: ordersLoading } = useRealtimeOrders(1, 5, 10000);
  const { stats, loading: statsLoading } = useRealtimeStats(10000);

  const STATS = [
    {
      name: "Total Sales",
      value: `£${stats.totalSales.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
      icon: TrendingUp,
      link: "/admin/transactions",
    },
    {
      name: "Total Orders",
      value: stats.totalOrders.toString(),
      icon: ShoppingBag,
      link: "/admin/orders",
    },
    {
      name: "Total Customers",
      value: stats.totalCustomers.toLocaleString(),
      icon: Users,
      link: "/admin/customers",
    },
    {
      name: "Total Products",
      value: stats.totalProducts.toString(),
      icon: Package,
      link: "/admin/products",
    },
    {
      name: "Subscribers",
      value: stats.totalSubscribers.toLocaleString(),
      icon: Mail,
      link: "/admin/subscribers",
    },
    {
      name: "Messages",
      value: stats.totalPendingQueries.toString(),
      icon: MessageSquare,
      link: "/admin/queries",
    },
  ];

  if (
    (ordersLoading && orders.length === 0) ||
    (statsLoading && stats.totalOrders === 0)
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-10 lg:space-y-12">
      <header className="space-y-3 lg:space-y-4">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-serif uppercase tracking-[0.2em] text-primary">
          Good Day,{" "}
          <span className="block sm:inline">
            {session?.user?.name || "Friend"}
          </span>
        </h1>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 lg:gap-5">
        {STATS.map((stat) => (
          <Link
            href={stat.link}
            key={stat.name}
            className="bg-white p-6 lg:p-8 border hover:bg-[#333] shadow-xl border-[#333]/10 hover:border-primary/50 hover:shadow-primary/5 transition-all duration-500 group"
          >
            <div className="flex justify-between items-start mb-4 lg:mb-6">
              <div className="p-2.5 lg:p-3 bg-secondary rounded-[5px] transition-colors duration-500">
                <stat.icon className="w-4 h-4 lg:w-5 h-5 stroke-[1.5] text-[#333] transition-colors duration-500" />
              </div>
              {/* <div className="flex items-center gap-1 text-[9px] lg:text-[10px] font-bold text-green-600">
                <ArrowUpRight className="w-2.5 h-2.5 lg:w-3 h-3" />
                {stat.change}
              </div> */}
            </div>
            <p className="text-[9px] lg:text-[10px] group-hover:text-white uppercase tracking-[0.2em] font-bold opacity-80 mb-1 lg:mb-2">
              {stat.name}
            </p>
            <p className="text-2xl lg:text-3xl font-serif text-[#333] group-hover:text-white">
              {stat.value}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8">
        <div className="bg-white p-6 lg:p-10 border border-[#333]/5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 lg:mb-10">
            <h2 className="text-lg lg:text-xl font-serif uppercase tracking-widest text-[#333]">
              Recently Placed
            </h2>
            <Link
              href="/admin/orders"
              className="text-[9px] lg:text-[10px] uppercase tracking-widest font-bold text-primary/80 hover:text-primary transition-all border-b border-primary/20 pb-0.5"
            >
              See All Orders
            </Link>
          </div>

          <div className="space-y-4 lg:space-y-6">
            {orders.slice(0, 5).map((order) => (
              <div
                key={order._id}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between py-6 lg:py-6 gap-4 sm:gap-6 border-b border-primary/30 last:border-0 hover:bg-secondary sm:px-6 transition-all duration-300 group"
              >
                <div className="flex items-center gap-4 lg:gap-6 w-full sm:w-auto">
                  <div className="w-max h-12 bg-secondary/20 flex items-center justify-center font-serif text-[10px] lg:text-sm shrink-0 border border-[#333]/5   transition-colors duration-500">
                    #{order.orderNumber}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-[#333] truncate">
                      {order.shippingAddress.firstName}{" "}
                      {order.shippingAddress.lastName}
                    </p>
                    <p className="text-[8px] lg:text-[10px] opacity-80 uppercase tracking-widest mt-0.5 lg:mt-1 truncate">
                      {order.items.length} Beautiful Item
                      {order.items.length !== 1 ? "s" : ""} • £
                      {order.totalAmount.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="flex sm:flex-row items-center justify-between w-full sm:w-auto gap-4 sm:gap-8">
                  <div className="flex flex-col items-end relative">
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
                        "appearance-none text-[8px] lg:text-[9px] px-3 py-2 border rounded-[5px] font-bold uppercase tracking-[0.2em] cursor-pointer outline-none transition-all disabled:opacity-90 disabled:cursor-not-allowed pr-8 relative z-10",
                        order.status === "Processing"
                          ? "bg-amber-100 text-amber-500 border-amber-200 hover:bg-amber-100"
                          : order.status === "Shipped" ||
                              order.status === "Out for Delivery"
                            ? "bg-blue-100 text-blue-500 border-blue-200 hover:bg-blue-100"
                            : order.status === "Delivered"
                              ? "bg-green-100 text-green-500 border-green-200 hover:bg-green-100"
                              : "bg-red-100 text-red-700 border-red-200 hover:bg-red-100",
                      )}
                      onClick={(e) => e.preventDefault()}
                    >
                      <option value="Processing">Processing</option>
                      <option value="Shipped">Shipped</option>
                      <option value="Out for Delivery">Out for Delivery</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none z-20">
                      {updatingOrderId === order._id ? (
                        <div className="w-2 h-2 border-2 border-[#333]/20 border-t-[#333] rounded-full animate-spin" />
                      ) : (
                        <ChevronDown className="w-3 h-3 opacity-80" />
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/admin/orders/${order._id}`}
                    className="text-[9px] lg:text-[10px] uppercase font-bold tracking-[0.3em] text-primary/80 hover:text-secondary transition-all py-2 rounded group-hover:bg-primary group-hover:text-secondary px-4 border-b border-primary/10 whitespace-nowrap"
                  >
                    View →
                  </Link>
                </div>
              </div>
            ))}
            {orders.length === 0 && (
              <div className="text-center py-10 opacity-80 uppercase tracking-widest text-xs font-bold">
                No orders have been placed yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

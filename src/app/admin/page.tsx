"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Package,
  Mail,
  MessageSquare,
  ChevronDown,
  ArrowUpRight,
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
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-[9px] uppercase tracking-[0.2em] font-bold text-primary">
          Overview
        </p>
        <h1 className="text-xl font-serif tracking-wide text-stone-800">
          Good day, {session?.user?.name || "Administrator"}
        </h1>
        <p className="text-xs text-stone-500">
          Here&apos;s what&apos;s happening across your store today.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {STATS.map((stat) => (
          <Link
            href={stat.link}
            key={stat.name}
            className="admin-stat-card group block"
          >
            <div className="flex justify-between items-start mb-3">
              <div className="admin-stat-icon">
                <stat.icon className="w-3.5 h-3.5 stroke-[1.75]" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-primary transition-colors" />
            </div>
            <p className="text-[9px] uppercase tracking-[0.12em] font-semibold text-stone-400 mb-0.5">
              {stat.name}
            </p>
            <p className="text-lg font-serif text-stone-800">{stat.value}</p>
          </Link>
        ))}
      </div>

      <div className="admin-panel-elevated p-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
          <div>
            <h2 className="text-base font-serif tracking-wide text-stone-800">
              Recent orders
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Latest activity from your storefront
            </p>
          </div>
          <Link
            href="/admin/orders"
            className="text-[10px] uppercase tracking-[0.14em] font-bold text-primary hover:opacity-80 transition-opacity"
          >
            View all orders
          </Link>
        </div>

        <div className="space-y-2">
          {orders.slice(0, 5).map((order) => (
            <div
              key={order._id}
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-md border border-stone-200/80 bg-stone-50/40 hover:bg-white hover:border-primary/20 transition-all group"
            >
              <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
                <div className="px-2.5 py-1.5 bg-white border border-stone-200 rounded font-serif text-[11px] text-stone-700 shrink-0">
                  #{order.orderNumber}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-800 truncate">
                    {order.shippingAddress.firstName}{" "}
                    {order.shippingAddress.lastName}
                  </p>
                  <p className="text-[10px] text-stone-500 mt-0.5 truncate">
                    {order.items.length} item{order.items.length !== 1 ? "s" : ""}{" "}
                    · £{order.totalAmount.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="flex sm:flex-row items-center justify-between w-full sm:w-auto gap-3">
                <div className="relative">
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
                            const errorData = await res.json().catch(() => ({}));
                            throw new Error(
                              errorData.error || "Failed to update status",
                            );
                          }
                          return res.json();
                        });

                        toast.promise(updatePromise, {
                          loading: `Updating order #${order.orderNumber}...`,
                          success: `Order #${order.orderNumber} updated to ${newStatus}`,
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
                      "appearance-none text-[9px] px-3 py-2 border rounded-md font-bold uppercase tracking-[0.15em] cursor-pointer outline-none pr-8",
                      order.status === "Processing"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : order.status === "Shipped" ||
                            order.status === "Out for Delivery"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : order.status === "Delivered"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-red-50 text-red-700 border-red-200",
                    )}
                    onClick={(e) => e.preventDefault()}
                  >
                    <option value="Processing">Processing</option>
                    <option value="Shipped">Shipped</option>
                    <option value="Out for Delivery">Out for Delivery</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                    {updatingOrderId === order._id ? (
                      <div className="w-2 h-2 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-stone-400" />
                    )}
                  </div>
                </div>

                <Link
                  href={`/admin/orders/${order._id}`}
                  className="text-[10px] uppercase font-bold tracking-[0.12em] text-primary hover:opacity-80 whitespace-nowrap"
                >
                  View →
                </Link>
              </div>
            </div>
          ))}

          {orders.length === 0 && (
            <div className="text-center py-12 text-stone-400 text-sm">
              No orders have been placed yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

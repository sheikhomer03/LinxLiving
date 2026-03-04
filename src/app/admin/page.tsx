"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  TrendingUp,
  ShoppingBag,
  Users,
  ArrowUpRight,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { useRealtimeStats } from "@/hooks/useRealtimeStats";

export default function AdminDashboard() {
  const { data: session } = useSession();
  const { orders, loading: ordersLoading } = useRealtimeOrders(10000);
  const { stats, loading: statsLoading } = useRealtimeStats(10000);

  const STATS = [
    {
      name: "Total Sales",
      value: `£${stats.totalSales.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
      change: "+12.5%",
      icon: TrendingUp,
    },
    {
      name: "Total Orders",
      value: stats.totalOrders.toString(),
      change: "+4.2%",
      icon: ShoppingBag,
    },
    {
      name: "Total Customers",
      value: stats.totalCustomers.toLocaleString(),
      change: "+8.1%",
      icon: Users,
    },
    {
      name: "Total Products",
      value: stats.totalProducts.toString(),
      change: "Curated",
      icon: Package,
    },
  ];

  if (
    (ordersLoading && orders.length === 0) ||
    (statsLoading && stats.totalOrders === 0)
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#333]/20 border-t-[#333] animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-10 lg:space-y-12">
      <header className="space-y-3 lg:space-y-4">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
          Good Day,{" "}
          <span className="block sm:inline">
            {session?.user?.name || "Friend"}
          </span>
        </h1>
        <p className="text-[10px] lg:text-[11px] uppercase tracking-widest font-bold opacity-40 leading-relaxed">
          Everything looks elegant today. Here's a quick look at your store.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
        {STATS.map((stat) => (
          <div
            key={stat.name}
            className="bg-white p-6 lg:p-8 border border-[#333]/20 hover:border-[#333]/70 hover:shadow-xl transition-all duration-500 group"
          >
            <div className="flex justify-between items-start mb-4 lg:mb-6">
              <div className="p-2.5 lg:p-3 bg-secondary/50 group-hover:bg-[#333] transition-colors duration-500">
                <stat.icon className="w-4 h-4 lg:w-5 h-5 stroke-[1.5] text-[#333] group-hover:text-white transition-colors duration-500" />
              </div>
              <div className="flex items-center gap-1 text-[9px] lg:text-[10px] font-bold text-green-600">
                <ArrowUpRight className="w-2.5 h-2.5 lg:w-3 h-3" />
                {stat.change}
              </div>
            </div>
            <p className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 mb-1 lg:mb-2">
              {stat.name}
            </p>
            <p className="text-2xl lg:text-3xl font-serif text-[#333]">
              {stat.value}
            </p>
          </div>
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
              className="text-[9px] lg:text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity border-b border-[#333]/20 pb-0.5"
            >
              See All Orders
            </Link>
          </div>

          <div className="space-y-4 lg:space-y-6">
            {orders.slice(0, 5).map((order) => (
              <div
                key={order._id}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between py-4 lg:py-4 gap-4 sm:gap-6 border-b border-[#333]/5 last:border-0 hover:bg-secondary/10 sm:px-4 transition-colors"
              >
                <div className="flex items-center gap-4 lg:gap-6 w-full sm:w-auto">
                  <div className="w-10 h-10 lg:w-12 h-12 bg-secondary/50 flex items-center justify-center font-serif text-[10px] lg:text-sm shrink-0">
                    #{order.orderNumber}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] lg:text-xs font-bold uppercase tracking-widest text-[#333] truncate">
                      Order #{order.orderNumber}
                    </p>
                    <p className="text-[8px] lg:text-[10px] opacity-40 uppercase tracking-widest mt-0.5 lg:mt-1 truncate">
                      {order.items.length} Beautiful Item
                      {order.items.length !== 1 ? "s" : ""} • Online
                    </p>
                  </div>
                </div>
                <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t border-[#333]/5 sm:border-0">
                  <p className="text-sm lg:text-base font-serif text-[#333]">
                    £{order.totalAmount.toFixed(2)}
                  </p>
                  <p
                    className={cn(
                      "text-[8px] lg:text-[9px] font-bold uppercase tracking-widest mt-0.5 lg:mt-1",
                      order.status === "Delivered"
                        ? "text-green-600"
                        : "text-amber-600",
                    )}
                  >
                    {order.status}
                  </p>
                </div>
              </div>
            ))}
            {orders.length === 0 && (
              <div className="text-center py-10 opacity-40 uppercase tracking-widest text-xs font-bold">
                No orders have been placed yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

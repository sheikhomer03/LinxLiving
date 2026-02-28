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

export default function AdminDashboard() {
  const { data: session } = useSession();
  const { orders, loading } = useRealtimeOrders(10000);

  const totalSales = orders.reduce((acc, order) => acc + order.totalAmount, 0);
  const totalOrders = orders.length;

  const STATS = [
    {
      name: "Total Sales",
      value: `£${totalSales.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
      change: "+12.5%",
      icon: TrendingUp,
    },
    {
      name: "Total Orders",
      value: totalOrders.toString(),
      change: "+4.2%",
      icon: ShoppingBag,
    },
    { name: "Total Customers", value: "1,240", change: "+8.1%", icon: Users },
    { name: "Total Products", value: "48", change: "Curated", icon: Package },
  ];

  if (loading && orders.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#333]/20 border-t-[#333] animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <header className="space-y-4">
        <h1 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
          Good Day, {session?.user?.name || "Friend"}
        </h1>
        <p className="text-[11px] uppercase tracking-widest font-bold opacity-40">
          Everything looks elegant today. Here's a quick look at your store.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {STATS.map((stat) => (
          <div
            key={stat.name}
            className="bg-white p-8 border border-[#333]/5 hover:border-[#333]/20 transition-all duration-500 group"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="p-3 bg-secondary/50 group-hover:bg-[#333] transition-colors duration-500">
                <stat.icon className="w-5 h-5 stroke-[1.5] text-[#333] group-hover:text-white transition-colors duration-500" />
              </div>
              <div className="flex items-center gap-1 text-[10px] font-bold text-green-600">
                <ArrowUpRight className="w-3 h-3" />
                {stat.change}
              </div>
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 mb-2">
              {stat.name}
            </p>
            <p className="text-3xl font-serif text-[#333]">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8">
        <div className="bg-white p-10 border border-[#333]/5">
          <div className="flex justify-between items-center mb-10">
            <h2 className="text-xl font-serif uppercase tracking-widest text-[#333]">
              Recently Placed
            </h2>
            <Link
              href="/admin/orders"
              className="text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity border-b border-[#333]/20"
            >
              See All Orders
            </Link>
          </div>

          <div className="space-y-6">
            {orders.slice(0, 5).map((order) => (
              <div
                key={order._id}
                className="flex items-center justify-between py-4 border-b border-[#333]/5 last:border-0 hover:bg-secondary/10 px-4 transition-colors"
              >
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 bg-secondary/50 flex items-center justify-center font-serif text-sm">
                    #{order.orderNumber}
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-[#333]">
                      Order #{order.orderNumber}
                    </p>
                    <p className="text-[10px] opacity-40 uppercase tracking-widest mt-1">
                      {order.items.length} Beautiful Item
                      {order.items.length !== 1 ? "s" : ""} • Online Payment
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-serif text-[#333]">
                    £{order.totalAmount.toFixed(2)}
                  </p>
                  <p
                    className={cn(
                      "text-[9px] font-bold uppercase tracking-widest mt-1",
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

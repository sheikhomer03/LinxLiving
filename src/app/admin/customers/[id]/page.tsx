"use client";

import React, { use, useState, useEffect } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Mail,
  Package,
  Clock,
  CheckCircle2,
  Truck,
  XCircle,
  Eye,
} from "lucide-react";
import { getCustomerWithOrders } from "@/app/actions/admin";
import { cn } from "@/lib/utils";

export default function CustomerOrdersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    setLoading(true);
    const result = await getCustomerWithOrders(id);
    setData(result);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#333]/10 border-t-[#333] rounded-full animate-spin" />
      </div>
    );
  }

  if (!data || !data.customer) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center space-y-4">
        <h2 className="text-2xl font-serif uppercase tracking-widest text-[#333]">
          Customer Not Found
        </h2>
        <Link
          href="/admin/customers"
          className="text-[10px] uppercase tracking-widest font-bold underline opacity-40 hover:opacity-100 transition-opacity"
        >
          Return to directory
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-12 pb-32 animate-in fade-in duration-1000">
      {/* Header */}
      <header className="space-y-4 lg:space-y-6 px-4 sm:px-0">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-black opacity-30 hover:opacity-100 transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
          Back to collective
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 lg:gap-8">
          <div className="space-y-3 lg:space-y-4">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-serif tracking-tight text-[#333] font-bold">
              {data.customer.name}
            </h1>
            <div className="flex flex-wrap gap-4 lg:gap-6">
              <div className="flex items-center gap-2 lg:gap-3 text-[9px] lg:text-[10px] uppercase tracking-[0.15em] lg:tracking-[0.2em] font-bold opacity-40">
                <Mail className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
                {data.customer.email}
              </div>
              <div className="flex items-center gap-2 lg:gap-3 text-[9px] lg:text-[10px] uppercase tracking-[0.15em] lg:tracking-[0.2em] font-bold opacity-40">
                <Clock className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
                Joined{" "}
                {new Date(data.customer.createdAt).toLocaleDateString(
                  undefined,
                  { month: "long", year: "numeric" },
                )}
              </div>
            </div>
          </div>

          <div className="px-6 lg:px-10 py-4 lg:py-6 bg-secondary/10 border border-[#333]/5 text-center space-y-1 w-fit">
            <p className="text-[8px] lg:text-[9px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-black opacity-30">
              Total Orders
            </p>
            <p className="text-2xl lg:text-3xl font-serif text-[#333]">
              {data.orders.length}
            </p>
          </div>
        </div>
      </header>

      {/* Orders Table */}
      <div className="space-y-6 lg:space-y-8 px-4 sm:px-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg lg:text-xl font-serif uppercase tracking-widest text-[#333]">
            Order History
          </h2>
          <div className="h-px flex-1 bg-[#333]/5" />
        </div>

        <div className="bg-white border border-[#333]/5 overflow-x-auto custom-scrollbar shadow-sm">
          <table className="w-full text-left border-collapse min-w-[700px] lg:min-w-0">
            <thead>
              <tr className="bg-secondary/30 border-b border-[#333]/5">
                <th className="px-8 py-5 text-[10px] uppercase tracking-widest font-bold opacity-40">
                  Order ID
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
            <tbody className="divide-y divide-[#333]/5 text-[#333]">
              {data.orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-8 py-20 text-center text-[10px] uppercase tracking-[0.3em] font-bold opacity-20"
                  >
                    No orders recorded for this customer
                  </td>
                </tr>
              ) : (
                data.orders.map((order: any) => (
                  <tr
                    key={order._id}
                    className="group hover:bg-secondary/10 transition-colors"
                  >
                    <td className="px-8 py-6 font-bold text-xs tracking-widest">
                      #{order.orderNumber}
                    </td>
                    <td className="px-8 py-6 text-[10px] opacity-40 uppercase tracking-widest font-bold">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-8 py-6 font-serif text-sm">
                      £{order.totalAmount.toFixed(2)}
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-2">
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
                        <span className="text-[9px] uppercase tracking-widest font-bold opacity-60">
                          {order.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <Link
                        href={`/admin/orders/${order._id}`}
                        className="inline-flex items-center gap-2 px-4 lg:px-6 py-2 border border-[#333]/5 group-hover:border-[#333]/20 text-[8px] lg:text-[9px] uppercase tracking-[0.2em] font-bold hover:bg-[#333] hover:text-white transition-all shadow-sm"
                      >
                        <Eye className="w-2.5 h-2.5 lg:w-3 lg:h-3 transition-transform group-hover:scale-110" />
                        Full Details
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

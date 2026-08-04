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
      <div className="min-h-[240px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/10 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!data || !data.customer) {
    return (
      <div className="min-h-[240px] flex flex-col items-center justify-center space-y-4">
        <h2 className="text-lg font-serif uppercase tracking-widest text-primary">
          Customer Not Found
        </h2>
        <Link
          href="/admin/customers"
          className="text-[10px] uppercase tracking-widest font-bold underline opacity-80 hover:opacity-800 transition-opacity"
        >
          Return to directory
        </Link>
      </div>
    );
  }

  return (
    <div className="admin-page animate-in fade-in duration-300">
      {/* Header */}
      <header className="space-y-4 lg:space-y-6 px-4 sm:px-0">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-black text-primary/60 hover:text-primary transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
          Back to collective
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div className="space-y-3 lg:space-y-4">
            <h1 className="admin-page-title font-serif text-primary">
              {data.customer.name}
            </h1>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 lg:gap-3 text-[9px] lg:text-[10px] uppercase tracking-[0.15em] lg:tracking-[0.12em] font-bold opacity-80">
                <Mail className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
                {data.customer.email}
              </div>
              <div className="flex items-center gap-2 lg:gap-3 text-[9px] lg:text-[10px] uppercase tracking-[0.15em] lg:tracking-[0.12em] font-bold opacity-80">
                <Clock className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
                Joined{" "}
                {new Date(data.customer.createdAt).toLocaleDateString(
                  undefined,
                  { month: "long", year: "numeric" },
                )}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 bg-primary/5 border border-primary/10 text-center space-y-1 w-fit shadow-xs">
            <p className="text-[8px] lg:text-[9px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-black text-primary/60">
              Total Orders
            </p>
            <p className="text-lg font-serif text-primary">
              {data.orders.length}
            </p>
          </div>
        </div>
      </header>

      {/* Orders Table */}
      <div className="space-y-6 lg:space-y-5 px-4 sm:px-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg lg:text-xl font-serif uppercase tracking-widest text-stone-800">
            Order History
          </h2>
          <div className="h-px flex-1 admin-btn-primary rounded-lg/5" />
        </div>

        <div className="bg-white border border-stone-200/80 overflow-x-auto custom-scrollbar shadow-sm">
          <table className="admin-responsive-table w-full text-left border-collapse">
            <thead>
              <tr className="admin-table-head border-b border-primary/10">
                <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold text-primary">
                  Order ID
                </th>
                <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold text-primary">
                  Date
                </th>
                <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold text-primary">
                  Amount
                </th>
                <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold text-primary">
                  Status
                </th>
                <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold text-primary text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-stone-800">
              {data.orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-[10px] uppercase tracking-[0.16em] font-bold opacity-90"
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
                    <td data-label="Order ID" className="px-4 py-3 font-bold text-xs tracking-widest">
                      #{order.orderNumber}
                    </td>
                    <td data-label="Date" className="px-4 py-3 text-[10px] opacity-80 uppercase tracking-widest font-bold">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                    <td data-label="Amount" className="px-4 py-3 font-serif text-sm">
                      £{order.totalAmount.toFixed(2)}
                    </td>
                    <td data-label="Status" className="px-4 py-3">
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
                        {(order.status === "Cancelled" ||
                          order.status === "Returned") && (
                          <XCircle className="w-3 h-3 text-red-500" />
                        )}
                        <span className="text-[9px] uppercase tracking-widest font-bold opacity-90">
                          {order.status}
                        </span>
                      </div>
                    </td>
                    <td data-label="Actions" className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/orders/${order._id}`}
                        className="inline-flex items-center gap-2 px-4 lg:px-6 py-2 border border-primary/10 group-hover:border-primary/30 text-[8px] lg:text-[9px] uppercase tracking-[0.12em] font-bold text-primary/80 hover:bg-primary hover:text-primary-foreground transition-all shadow-sm"
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

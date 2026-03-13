import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import type { Order } from "@/hooks/useRealtimeOrders";

import { OrdersReturnsSkeleton } from "./ProfileSkeletons";

export function OrdersReturns() {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { orders, totalPages, loading, error } = useRealtimeOrders(
    currentPage,
    itemsPerPage,
    10000,
  );

  // Reset to page 1 if tab is switched (though here it's managed by parent component)
  useEffect(() => {
    // Optionally handle any reset logic here
  }, []);

  if (loading && orders.length === 0) {
    return <OrdersReturnsSkeleton />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="space-y-2">
        <h3 className="text-xl font-serif tracking-widest uppercase text-primary">
          Orders & Returns
        </h3>
        <p className="text-sm text-muted-foreground font-sans">
          Track your recent orders or initiate a return.
        </p>
      </div>

      <div className="py-8 border-t border-foreground/5 overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-foreground/5">
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold text-primary">
                Order ID
              </th>
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold text-primary">
                Date
              </th>
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold text-primary">
                Status
              </th>
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold text-primary text-right">
                Total
              </th>
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold text-primary text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {orders.map((order) => (
              <tr
                key={order._id}
                className="hover:bg-secondary/10 transition-colors group"
              >
                <td className="py-5 text-sm font-sans">#{order.orderNumber}</td>
                <td className="py-5 text-sm font-sans">
                  {new Date(order.createdAt).toLocaleDateString()}
                </td>
                <td className="py-5 text-[10px] uppercase tracking-widest font-bold">
                  {order.status}
                </td>
                <td className="py-5 text-sm font-sans text-right">
                  £{order.totalAmount.toFixed(2)}
                </td>
                <td className="py-5 text-right">
                  <Link
                    href={`/profile/orders/${order._id}`}
                    className="text-[10px] uppercase tracking-widest font-bold border-b border-primary/20 hover:border-primary hover:text-primary transition-all pb-1"
                  >
                    Track Order
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-10 border-t border-foreground/5">
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary/60">
              Page <span className="text-primary">{currentPage}</span> of{" "}
              <span className="text-primary">{totalPages}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-3 border border-primary/10 bg-white hover:bg-primary hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-current group"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - currentPage) <= 1,
                )
                .map((pageNum, index, array) => (
                  <React.Fragment key={pageNum}>
                    {index > 0 && array[index - 1] !== pageNum - 1 && (
                      <span className="text-primary/30">...</span>
                    )}
                    <button
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-10 h-10 text-[10px] uppercase font-bold tracking-widest transition-all border ${
                        currentPage === pageNum
                          ? "bg-primary text-white border-primary shadow-lg shadow-primary/20"
                          : "bg-white border-primary/10 hover:border-primary/30 text-primary/60 hover:text-primary"
                      }`}
                    >
                      {pageNum}
                    </button>
                  </React.Fragment>
                ))}
            </div>

            <button
              onClick={() =>
                setCurrentPage((prev) => Math.min(totalPages, prev + 1))
              }
              disabled={currentPage === totalPages}
              className="p-3 border border-primary/10 bg-white hover:bg-primary hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-current group"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {orders.length === 0 && !loading && (
        <div className="py-20 text-center border-t border-foreground/5">
          <p className="text-sm text-muted-foreground font-sans">
            You haven't placed any orders yet.
          </p>
        </div>
      )}
    </div>
  );
}

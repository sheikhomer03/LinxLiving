import Link from "next/link";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import type { Order } from "@/hooks/useRealtimeOrders";

import { OrdersReturnsSkeleton } from "./ProfileSkeletons";

export function OrdersReturns() {
  const { orders, loading, error } = useRealtimeOrders(10000);

  if (loading && orders.length === 0) {
    return <OrdersReturnsSkeleton />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="space-y-2">
        <h3 className="text-xl font-serif tracking-widest uppercase">
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
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold opacity-80">
                Order ID
              </th>
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold opacity-80">
                Date
              </th>
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold opacity-80">
                Status
              </th>
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 text-right">
                Total
              </th>
              <th className="py-4 text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 text-right">
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
                    className="text-[10px] uppercase tracking-widest font-bold border-b border-[#333]/20 hover:border-[#333] transition-all pb-1"
                  >
                    Track Order
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

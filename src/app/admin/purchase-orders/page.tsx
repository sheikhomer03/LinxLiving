"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getPurchaseOrders,
  updatePurchaseOrderStatus,
  emailPurchaseOrderToSupplier,
} from "@/app/actions/purchaseOrders";
import { cn } from "@/lib/utils";

const STATUSES = [
  "Draft",
  "Submitted",
  "Confirmed",
  "Partially Received",
  "Received",
  "Cancelled",
  "Failed",
] as const;

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await getPurchaseOrders();
    if (res.success) setRows(res.purchaseOrders);
    else toast.error("Failed to load purchase orders");
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    const res = await updatePurchaseOrderStatus(id, status);
    if (res.success) {
      toast.success("Status updated");
      load();
    } else toast.error(res.error || "Update failed");
  };

  const saveTracking = async (po: any) => {
    const trackingNumber = window.prompt(
      "Tracking number",
      po.trackingNumber || "",
    );
    if (trackingNumber == null) return;
    const trackingCarrier =
      window.prompt("Carrier (DPD, DHL, Evri…)", po.trackingCarrier || "") ||
      "";
    const res = await updatePurchaseOrderStatus(po._id, po.status, {
      trackingNumber,
      trackingCarrier,
      notifyCustomer: true,
    });
    if (res.success) {
      toast.success("Tracking saved — customer notified if email available");
      load();
    } else toast.error(res.error || "Failed");
  };

  const emailSupplier = async (id: string) => {
    const res = await emailPurchaseOrderToSupplier(id);
    if (res.success) {
      toast.success("PO emailed to supplier");
      load();
    } else toast.error(res.error || "Email failed");
  };

  return (
    <div className="max-w-7xl mx-auto admin-page pb-8 animate-in fade-in duration-300">
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary">Purchase Orders</span>
      </nav>

      <header className="admin-page-header">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary uppercase">
            Purchase Orders
          </h1>
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-stone-500">
            Supplier POs created from customer orders
          </p>
        </div>
        <Link
          href="/admin/orders"
          className="admin-btn-primary text-[10px] uppercase tracking-widest font-bold px-4 py-2"
        >
          Open orders
        </Link>
      </header>

      <div className="bg-white admin-panel-elevated overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary/20" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-[11px] uppercase tracking-widest font-bold text-stone-400">
            No purchase orders yet. Open a customer order and click “Create PO”.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/40 text-[9px] uppercase tracking-widest text-stone-500">
                <tr>
                  <th className="px-4 py-3">PO</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Customer order</th>
                  <th className="px-4 py-3">Cost</th>
                  <th className="px-4 py-3">Margin</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Tracking</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((po) => (
                  <tr key={po._id} className="hover:bg-secondary/20">
                    <td className="px-4 py-3 font-bold text-stone-800">
                      {po.poNumber}
                      <div className="text-[10px] text-stone-400 font-normal">
                        {po.items?.length || 0} lines
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {po.supplier?.name || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {po.order ? (
                        <Link
                          href={`/admin/orders/${po.order}`}
                          className="text-primary underline"
                        >
                          {po.orderNumber || po.order}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      £{Number(po.totalCost || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      {po.estimatedMarginPercent != null
                        ? `${po.estimatedMarginPercent}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={po.status}
                        onChange={(e) => setStatus(po._id, e.target.value)}
                        className={cn(
                          "text-xs border border-stone-200 px-2 py-1 bg-white",
                          po.status === "Failed" && "text-red-600",
                          po.status === "Confirmed" && "text-green-700",
                        )}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-500">
                      {po.trackingNumber ? (
                        <button
                          type="button"
                          onClick={() => saveTracking(po)}
                          className="text-left hover:text-primary"
                        >
                          <div>{po.trackingCarrier || "Courier"}</div>
                          <div className="font-mono">{po.trackingNumber}</div>
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => emailSupplier(po._id)}
                          className="text-[9px] uppercase tracking-widest font-bold text-primary hover:underline text-left"
                        >
                          Email supplier
                        </button>
                        <button
                          type="button"
                          onClick={() => saveTracking(po)}
                          className="text-[9px] uppercase tracking-widest font-bold text-stone-600 hover:underline text-left"
                        >
                          Set tracking
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

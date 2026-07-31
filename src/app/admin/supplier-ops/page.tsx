"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSupplierOpsReport } from "@/app/actions/supplierReports";
import {
  getSupplierSyncLogs,
  runAllSupplierSyncs,
} from "@/app/actions/supplierSync";

export default function SupplierOpsPage() {
  const [report, setReport] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const [res, logRes] = await Promise.all([
      getSupplierOpsReport(),
      getSupplierSyncLogs(25),
    ]);
    if (res.success) setReport(res.report);
    else toast.error("Failed to load report");
    if (logRes.success) setLogs(logRes.logs);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const cards = report
    ? [
        { label: "Active suppliers", value: report.suppliers.active },
        { label: "Products linked", value: report.productsWithSupplier },
        { label: "Low stock", value: report.lowStock },
        { label: "Out of stock", value: report.outOfStock },
        { label: "Orders (24h)", value: report.dailyOrders },
        {
          label: "Sales (24h)",
          value: `£${Number(report.dailySales || 0).toFixed(2)}`,
        },
        { label: "Price updates (24h)", value: report.priceChanges24h },
      ]
    : [];

  return (
    <div className="max-w-7xl mx-auto admin-page pb-8 animate-in fade-in duration-300">
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary">Supplier Ops</span>
      </nav>

      <header className="admin-page-header">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary uppercase">
            Supplier Ops
          </h1>
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-stone-500">
            Stock, pricing, sales and supplier performance
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              const res = await runAllSupplierSyncs(true);
              setSyncing(false);
              if (res.success) {
                toast.success(`Ran sync for ${res.count} feed(s)`);
                setLoading(true);
                load();
              } else toast.error("Sync failed");
            }}
            className="text-[10px] uppercase tracking-widest font-bold border border-primary/30 px-3 py-2 text-primary disabled:opacity-60"
          >
            {syncing ? "Syncing…" : "Run feed sync"}
          </button>
          <Link
            href="/admin/suppliers"
            className="text-[10px] uppercase tracking-widest font-bold border border-primary/30 px-3 py-2 text-primary"
          >
            Suppliers
          </Link>
          <Link
            href="/admin/purchase-orders"
            className="text-[10px] uppercase tracking-widest font-bold border border-primary/30 px-3 py-2 text-primary"
          >
            Purchase orders
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary/20" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
            {cards.map((c) => (
              <div
                key={c.label}
                className="bg-white admin-panel-elevated p-4 space-y-2"
              >
                <p className="text-[9px] uppercase tracking-widest font-bold text-stone-400">
                  {c.label}
                </p>
                <p className="text-xl font-serif text-primary">{c.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white admin-panel-elevated overflow-hidden mb-8">
            <div className="px-4 py-3 border-b border-stone-100">
              <h2 className="text-[11px] uppercase tracking-widest font-black">
                Recent sync logs
              </h2>
            </div>
            {logs.length === 0 ? (
              <p className="p-4 text-xs text-stone-400">
                No sync runs yet. Set a feed URL on a supplier and click Sync.
              </p>
            ) : (
              <ul className="divide-y divide-stone-100 text-xs">
                {logs.map((log) => (
                  <li
                    key={log._id}
                    className="px-4 py-3 flex flex-wrap gap-3 items-center"
                  >
                    <span
                      className={
                        log.success
                          ? "text-green-700 font-bold"
                          : "text-red-600 font-bold"
                      }
                    >
                      {log.success ? "OK" : "FAIL"}
                    </span>
                    <span className="font-bold">
                      {log.supplier?.name || "Supplier"}
                    </span>
                    <span className="text-stone-500 uppercase">
                      {log.connector}
                    </span>
                    <span>
                      +{log.updated} / skip {log.skipped}
                    </span>
                    <span className="text-stone-400 ml-auto">
                      {log.createdAt
                        ? new Date(log.createdAt).toLocaleString()
                        : ""}
                    </span>
                    {log.message ? (
                      <span className="w-full text-stone-500">{log.message}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white admin-panel-elevated overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100">
              <h2 className="text-[11px] uppercase tracking-widest font-black">
                Supplier performance
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-[9px] uppercase tracking-widest text-stone-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Supplier</th>
                    <th className="px-4 py-3 text-left">Connector</th>
                    <th className="px-4 py-3 text-right">Products</th>
                    <th className="px-4 py-3 text-right">Low</th>
                    <th className="px-4 py-3 text-right">OOS</th>
                    <th className="px-4 py-3 text-right">Avg margin</th>
                    <th className="px-4 py-3 text-left">Last stock sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {(report?.supplierPerformance || []).map((row: any) => (
                    <tr key={row.supplierId}>
                      <td className="px-4 py-3 font-bold">
                        {row.name}
                        {!row.isActive ? (
                          <span className="ml-2 text-[9px] text-stone-400">
                            OFF
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs uppercase tracking-wide text-stone-500">
                        {row.integrationType}
                      </td>
                      <td className="px-4 py-3 text-right">{row.products}</td>
                      <td className="px-4 py-3 text-right text-amber-700">
                        {row.lowStock}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">
                        {row.outOfStock}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.avgMargin != null ? `${row.avgMargin}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-500">
                        {row.lastStockSyncAt
                          ? new Date(row.lastStockSyncAt).toLocaleString()
                          : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

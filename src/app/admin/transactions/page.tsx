"use client";

import React, { useState, useEffect } from "react";
import {
  CreditCard,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Building2,
  Receipt,
  X,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import {
  getStripeTransactions,
  refundStripeCharge,
  getStripeAccount,
} from "@/app/actions/stripe";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(
    undefined,
  );
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [chargeIdToRefund, setChargeIdToRefund] = useState<string | null>(null);

  const fetchData = async (cursor?: string, status = statusFilter) => {
    setLoading(true);
    const [transResult, accountResult] = await Promise.all([
      getStripeTransactions(cursor, status),
      !accountInfo ? getStripeAccount() : Promise.resolve(null),
    ]);

    if (transResult.success) {
      setTransactions(transResult.data);
      setHasMore(transResult?.hasMore || false);
      setNextCursor(transResult?.lastId || undefined);
    } else {
      toast.error(transResult.error || "Failed to fetch transactions");
    }

    if (accountResult?.success) {
      setAccountInfo(accountResult.data);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleFilterChange = (newStatus: string) => {
    setStatusFilter(newStatus);
    setCursors([]);
    setCurrentCursor(undefined);
    setNextCursor(undefined);
    fetchData(undefined, newStatus);
  };

  const handleNext = () => {
    if (nextCursor && hasMore) {
      setCursors([...cursors, currentCursor || ""]);
      setCurrentCursor(nextCursor);
      fetchData(nextCursor, statusFilter);
    }
  };

  const handlePrevious = () => {
    const prevCursors = [...cursors];
    const prevCursor = prevCursors.pop();
    setCursors(prevCursors);
    setCurrentCursor(prevCursor || "");
    setNextCursor(undefined); // Will be set by fetchData
    fetchData(prevCursor === "" ? undefined : prevCursor, statusFilter);
  };

  const confirmRefund = async () => {
    if (!chargeIdToRefund) return;
    setProcessingId(chargeIdToRefund);
    setShowRefundModal(false);

    const result = await refundStripeCharge(chargeIdToRefund);

    if (result.success) {
      toast.success("Refund processed");
      fetchData(currentCursor, statusFilter);
    } else {
      toast.error(result.error || "Refund failed");
    }
    setProcessingId(null);
    setChargeIdToRefund(null);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <div className="space-y-10 lg:space-y-12 pb-32 animate-in fade-in duration-1000">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-8">
        <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-[#333] font-bold">
          Transactions
        </h1>
        <div className="flex items-center gap-3 lg:gap-4 w-full sm:w-auto">
          <button
            onClick={() => fetchData(currentCursor)}
            className="group p-2.5 lg:p-3 bg-white border border-[#333]/10 hover:border-[#333]/20 transition-all rounded-full shadow-sm shrink-0"
            title="Sync Ledger"
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5 lg:w-4 h-4 text-[#333]/60 group-hover:text-[#333] transition-colors",
                loading && "animate-spin",
              )}
            />
          </button>
          <div className="relative grow sm:grow-0">
            <select
              value={statusFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="w-full appearance-none bg-white border border-[#333]/10 px-4 lg:px-6 py-2.5 lg:py-3 pr-10 lg:pr-12 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] font-bold text-[#333] outline-none transition-all cursor-pointer hover:border-[#333]/20 shadow-sm"
            >
              <option value="all">Filter: All</option>
              <option value="succeeded">Success</option>
              <option value="failed">Failed</option>
            </select>
            <ChevronDown className="w-3 h-3 absolute right-4 lg:right-5 top-1/2 -translate-y-1/2 pointer-events-none opacity-40 text-[#333]" />
          </div>
        </div>
      </header>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Volume */}
        <div className="bg-white p-6 lg:p-8 border border-[#333]/5 shadow-sm group hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4 lg:mb-6">
            <p className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-30 group-hover:opacity-50 transition-opacity">
              Batch Volume
            </p>
            <CreditCard className="w-4 h-4 text-[#333]/20 group-hover:text-[#333]/40 transition-colors" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-serif font-bold text-[#333]">
              GBP
            </span>
            <span className="text-3xl lg:text-4xl font-serif font-bold text-[#333]">
              {formatAmount(
                transactions.reduce(
                  (acc: number, curr: any) =>
                    acc + (curr.amount > 0 ? curr.amount : 0),
                  0,
                ),
                "gbp",
              ).replace("£", "")}
            </span>
          </div>
        </div>

        {/* Card 2: Account Details */}
        <div className="bg-white p-6 lg:p-8 border border-[#333]/5 shadow-sm group hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4 lg:mb-6">
            <p className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-30 group-hover:opacity-50 transition-opacity">
              Connected Identity
            </p>
            <Building2 className="w-4 h-4 text-[#333]/20 group-hover:text-[#333]/40 transition-colors" />
          </div>
          <div className="space-y-1">
            <p className="text-base lg:text-lg font-serif font-bold text-[#333] truncate">
              {accountInfo?.email || "Stripe Managed Node"}
            </p>
            <p className="text-[9px] uppercase tracking-widest font-black opacity-20 truncate">
              ID: {accountInfo?.id || "N/A"}
            </p>
          </div>
        </div>

        {/* Card 3: Meaningful Metric - Active Refunds */}
        <div className="bg-white p-6 lg:p-8 border border-[#333]/5 shadow-sm group hover:shadow-md transition-shadow border-l-4 border-l-red-500/10">
          <div className="flex items-center justify-between mb-4 lg:mb-6">
            <p className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-30 group-hover:opacity-50 transition-opacity">
              Refunded Magnitude
            </p>
            <Receipt className="w-4 h-4 text-[#333]/20 group-hover:text-[#333]/40 transition-colors" />
          </div>
          <div className="flex items-baseline gap-2 text-red-600/60">
            <span className="text-2xl lg:text-3xl font-serif font-bold">
              GBP
            </span>
            <span className="text-3xl lg:text-4xl font-serif font-bold">
              {formatAmount(
                transactions.reduce(
                  (acc: number, curr: any) =>
                    acc + (curr.refunded ? curr.amount : 0),
                  0,
                ),
                "gbp",
              ).replace("£", "")}
            </span>
          </div>
        </div>
      </div>

      {/* Simplified Transactions Table */}
      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#333] text-white font-black text-[11px] uppercase tracking-[0.2em]">
                <th className="px-10 py-5">Node Status</th>
                <th className="px-10 py-5">Customer Ledger</th>
                <th className="px-10 py-5 text-right">Value</th>
                <th className="px-10 py-5">Timestamp</th>
                <th className="px-10 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333]/10">
              {loading && transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-10 py-24 text-center">
                    <div className="flex flex-col items-center gap-4 animate-pulse">
                      <div className="w-10 h-10 border-4 border-[#333]/10 border-t-[#333] rounded-full animate-spin" />
                    </div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-20 lg:py-32 text-center text-[#333]"
                  >
                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="w-20 h-20 bg-secondary/10 flex items-center justify-center rounded-full border border-[#333]/5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                        <Receipt className="w-10 h-10 opacity-20 text-[#333]" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-serif font-bold">
                          No Transactions Found
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.2em] font-black opacity-40">
                          {statusFilter !== "all"
                            ? `No transactions match the "${statusFilter}" filter`
                            : "No transactions processed yet"}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                transactions.map((tx: any) => (
                  <tr
                    key={tx.id}
                    className="group hover:bg-neutral-50 transition-all duration-300"
                  >
                    <td className="px-10 py-7">
                      <div className="flex items-center gap-3">
                        {tx.refunded ? (
                          <div className="flex items-center gap-2 text-amber-600">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            <span className="text-[9px] uppercase tracking-widest font-black">
                              Refunded
                            </span>
                          </div>
                        ) : tx.status === "succeeded" ? (
                          <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span className="text-[9px] uppercase tracking-widest font-black">
                              Success
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-neutral-400">
                            <Clock className="w-3.5 h-3.5" />
                            <span className="text-[9px] uppercase tracking-widest font-black">
                              {tx.status}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-10 py-7">
                      <div className="flex flex-col">
                        <span className=" font-serif font-medium text-[#333]">
                          {tx.billing_details?.email ||
                            tx.receipt_email ||
                            "Guest"}
                        </span>
                        <span className="text-[10px] uppercase tracking-widest opacity-70 font-mono mt-0.5">
                          {tx.id}
                        </span>
                      </div>
                    </td>
                    <td className="px-10 py-7 text-right font-serif font-bold text-base">
                      <span
                        className={
                          tx.amount > 0 ? "text-[#333]" : "text-red-500"
                        }
                      >
                        {formatAmount(tx.amount, tx.currency)}
                      </span>
                    </td>
                    <td className="px-10 py-7 text-[10px] uppercase tracking-widest font-black text-[#333]/40">
                      {formatDate(tx.created)}
                    </td>
                    <td className="px-10 py-7 text-right">
                      {tx.status === "succeeded" && !tx.refunded && (
                        <button
                          onClick={() => {
                            setChargeIdToRefund(tx.id);
                            setShowRefundModal(true);
                          }}
                          disabled={processingId === tx.id}
                          className="px-5 py-2.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition-all text-[9px] uppercase tracking-widest font-black disabled:opacity-30 border border-red-100"
                        >
                          {processingId === tx.id ? "..." : "Refund"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-8 border-t border-[#333]/5 bg-neutral-50/50 flex items-center justify-between">
          <p className="text-[9px] uppercase tracking-[0.4em] font-black opacity-20">
            Vector Node: {cursors.length + 1}
          </p>
          <div className="flex gap-4">
            <button
              onClick={handlePrevious}
              disabled={cursors.length === 0 || loading}
              className="flex items-center gap-3 px-8 py-3.5 border border-[#333]/10 text-[9px] uppercase tracking-[0.3em] font-bold text-[#333] bg-white hover:bg-neutral-50 disabled:opacity-20 transition-all shadow-sm"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Previously
            </button>
            <button
              onClick={handleNext}
              disabled={!hasMore || loading}
              className="flex items-center gap-3 px-8 py-3.5 border border-[#333]/10 text-[9px] uppercase tracking-[0.3em] font-bold text-[#333] bg-white hover:bg-neutral-50 disabled:opacity-20 transition-all shadow-sm"
            >
              Further
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Refund Confirmation Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowRefundModal(false)}
          />

          {/* Modal Content */}
          <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => setShowRefundModal(false)}
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8 md:p-12 text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertCircle className="w-8 h-8 text-red-600 opacity-60" />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-2xl font-serif tracking-widest uppercase text-[#333]">
                  Confirm Refund
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Are you sure you want to refund this transaction? <br />
                  <span className="font-bold text-[#333] mt-2 block break-all text-xs opacity-50">
                    {chargeIdToRefund}
                  </span>
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={confirmRefund}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg flex items-center justify-center gap-3"
                >
                  Process Refund
                </button>
                <button
                  onClick={() => setShowRefundModal(false)}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 hover:opacity-100 transition-opacity pt-2"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="h-1.5 w-full bg-linear-to-r from-red-600/20 via-red-600/10 to-transparent" />
          </div>
        </div>
      )}
    </div>
  );
}

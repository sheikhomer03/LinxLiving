"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Ticket,
  Calendar,
  DollarSign,
  Percent,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface CouponFormProps {
  initialData?: any;
  action: (data: any) => Promise<{ success: boolean; error?: string }>;
  title: string;
}

export function CouponForm({ initialData, action, title }: CouponFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Default expiry date: 30 days from now
  const defaultExpiry = new Date();
  defaultExpiry.setDate(defaultExpiry.getDate() + 30);
  const defaultExpiryStr = defaultExpiry.toISOString().split("T")[0];
  const defaultStartStr = new Date().toISOString().split("T")[0];

  const [formData, setFormData] = useState({
    code: initialData?.code || "",
    discountType: initialData?.discountType || "percentage",
    discountAmount: initialData?.discountAmount || "",
    minOrderAmount: initialData?.minOrderAmount || 0,
    startDate: initialData?.startDate
      ? new Date(initialData.startDate).toISOString().split("T")[0]
      : defaultStartStr,
    expiryDate: initialData?.expiryDate
      ? new Date(initialData.expiryDate).toISOString().split("T")[0]
      : defaultExpiryStr,
    usageLimit: initialData?.usageLimit || "",
    isActive: initialData?.isActive ?? true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const submissionData = {
        ...formData,
        discountAmount: Number(formData.discountAmount),
        minOrderAmount: Number(formData.minOrderAmount),
        usageLimit:
          formData.usageLimit === "" ? null : Number(formData.usageLimit),
        startDate: new Date(formData.startDate),
        expiryDate: new Date(formData.expiryDate),
      };

      if (submissionData.discountAmount <= 0) {
        toast.error("Discount amount must be greater than 0.");
        setLoading(false);
        return;
      }
      if (
        submissionData.discountType === "percentage" &&
        submissionData.discountAmount > 100
      ) {
        toast.error("Percentage discount cannot exceed 100%.");
        setLoading(false);
        return;
      }

      const result = await action(submissionData);
      if (result.success) {
        toast.success(
          initialData
            ? "Coupon updated successfully"
            : "Coupon created successfully",
        );
        router.push("/admin/coupons");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to save coupon");
      }
    } catch (error: any) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-32 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      <header className="mb-16 space-y-8">
        <Link
          href="/admin/coupons"
          className="inline-flex items-center gap-3 text-[10px] uppercase tracking-[0.4em] font-black text-[#333]/60 hover:text-[#333] transition-all group"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Coupons
        </Link>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div className="space-y-4">
            <h1 className="text-2xl lg:text-3xl font-serif tracking-tight text-[#333] font-bold leading-tight">
              {title}
            </h1>
            <div className="flex items-center gap-4">
              <div className="h-px w-8 bg-[#333]/10" />
              <p className="text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/40">
                Promotional Asset Configuration
              </p>
            </div>
          </div>

          {/* Quick Preview Badge */}
          {/* <div className="hidden md:block">
            <div className="bg-white border border-[#333]/5 shadow-xl px-8 py-6 flex items-center gap-6">
              <div className="w-12 h-12 bg-secondary/30 flex items-center justify-center rounded-sm">
                <Ticket className="w-6 h-6 text-[#333]" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest font-black opacity-90">
                  Status Preview
                </p>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${formData.isActive ? "bg-green-500" : "bg-amber-500"}`}
                  />
                  <span className="text-xs uppercase tracking-widest font-bold">
                    {formData.isActive ? "Active Asset" : "Draft Archive"}
                  </span>
                </div>
              </div>
            </div>
          </div> */}
        </div>
      </header>

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8"
      >
        <div className="lg:col-span-8 space-y-12">
          {/* Section 1: Core Identity */}
          <div className="group space-y-8">
            <div className="bg-white shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] border border-[#333]/5 p-5 lg:p-8 space-y-12 transition-all duration-700 group-hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.15)]">
              {/* Coupon Code Input */}
              <div className="space-y-6">
                <label className="text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/60">
                  Access Code
                </label>
                <div className="relative mt-2">
                  <input
                    required
                    type="text"
                    placeholder="Enter Code (e.g. SUMMER24)"
                    className="w-full input-standard bg-secondary/10 border-l-4 border-transparent focus:border-l-[#333] focus:bg-white px-4 py-3 font-serif tracking-[0.2em] uppercase outline-none transition-all duration-500 shadow-inner"
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        code: e.target.value.toUpperCase(),
                      })
                    }
                  />
                  <Ticket className="absolute right-8 top-1/2 -translate-y-1/2 w-6 h-6 opacity-80" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                {/* Reward Structure */}
                <div className="space-y-6">
                  <label className="text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/60">
                    Coupon Type
                  </label>
                  <div className="flex gap-2 mt-2 bg-secondary/20 rounded-sm">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, discountType: "percentage" })
                      }
                      className={`flex-1 py-4 flex items-center justify-center gap-3 transition-all duration-500 font-bold text-[10px] uppercase tracking-widest ${
                        formData.discountType === "percentage"
                          ? "bg-[#333] text-white shadow-md border border-[#333] scale-100"
                          : "bg-white text-[#333] shadow-md border border-[#333] scale-95"
                      }`}
                    >
                      <Percent className="w-3.5 h-3.5" />
                      Percent
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, discountType: "fixed" })
                      }
                      className={`flex-1 py-4 flex items-center justify-center gap-3 transition-all duration-500 font-bold text-[10px] uppercase tracking-widest ${
                        formData.discountType === "fixed"
                          ? "bg-[#333] text-white shadow-md border border-[#333] scale-100"
                          : "bg-white text-[#333] shadow-md border border-[#333] scale-95"
                      }`}
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      Fixed
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div className="space-y-6">
                  <label className="text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/60">
                    Amount Value{" "}
                    {formData.discountType === "percentage" ? "(%)" : "(£)"}
                  </label>
                  <div className="relative group mt-2">
                    <input
                      required
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full input-standard bg-transparent border-b-2 border-[#333]/10 focus:border-[#333] px-2 py-3 font-serif outline-none transition-all duration-500"
                      value={formData.discountAmount}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          discountAmount: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Parameters */}
          <div className="group space-y-8">
            <div className="bg-white shadow-[0_30px_60px_-15px_rgba(0,0,0,0.05)] border border-[#333]/5 p-5 lg:p-8 space-y-12 transition-all duration-700 group-hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.08)]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/60 flex items-center gap-3">
                    <Calendar className="w-3.5 h-3.5 opacity-80" />
                    Start Date
                  </label>
                  <input
                    required
                    type="date"
                    className="w-full input-standard bg-secondary/10 border-b border-transparent focus:border-[#333] px-6 py-3 font-bold tracking-[0.2em] text-sm uppercase outline-none transition-all duration-500"
                    value={formData.startDate}
                    onChange={(e) =>
                      setFormData({ ...formData, startDate: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/60 flex items-center gap-3">
                    <Calendar className="w-3.5 h-3.5 opacity-80" />
                    Expiration
                  </label>
                  <input
                    required
                    type="date"
                    className="w-full input-standard bg-secondary/10 border-b border-transparent focus:border-[#333] px-6 py-3 font-bold tracking-[0.2em] text-sm uppercase outline-none transition-all duration-500"
                    value={formData.expiryDate}
                    onChange={(e) =>
                      setFormData({ ...formData, expiryDate: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-2 mt-4">
                  <label className="text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/60">
                    Minimum Transaction
                  </label>
                  <div className="relative mt-2">
                    <input
                      required
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full input-standard bg-secondary/10 border-b border-transparent focus:border-[#333] px-6 py-3 font-bold tracking-[0.2em] text-sm uppercase outline-none transition-all duration-500"
                      value={formData.minOrderAmount}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          minOrderAmount: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2 mt-4">
                  <label className="text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/60">
                    Usage Limit
                  </label>
                  <div className="relative mt-2">
                    <input
                      type="number"
                      placeholder="Unlimited"
                      className="w-full input-standard bg-secondary/10 border-b border-transparent focus:border-[#333] px-6 py-3 font-bold tracking-[0.2em] text-sm uppercase outline-none transition-all duration-500"
                      value={formData.usageLimit}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) =>
                        setFormData({ ...formData, usageLimit: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Floating Action Column */}
        <div className="lg:col-span-4 lg:pl-4">
          <div className="sticky top-32 space-y-8 animate-in slide-in-from-right-8 duration-1000 delay-300">
            <div className="bg-[#333] p-10 space-y-10 shadow-2xl relative overflow-hidden group">
              {/* Decorative Element */}
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all duration-1000" />

              <div className="space-y-6 relative z-10">
                <div
                  onClick={() =>
                    setFormData({ ...formData, isActive: !formData.isActive })
                  }
                  className="flex items-center justify-between cursor-pointer group/toggle"
                >
                  <span className="text-[11px] uppercase tracking-widest font-bold text-white">
                    {formData.isActive ? "Active" : "Inactive"}
                  </span>
                  <div
                    className={`w-14 h-7 rounded-full transition-all duration-500 p-1 flex items-center ${
                      formData.isActive ? "bg-white" : "bg-white/10"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full transition-all duration-500 shadow-md ${
                        formData.isActive
                          ? "translate-x-7 bg-[#333]"
                          : "translate-x-0 bg-white"
                      }`}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-10 border-t border-white/10 relative z-10">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-white text-[#333] py-4 transition-all duration-500 hover:scale-[1.02] active:scale-[0.98] shadow-xl flex items-center justify-center gap-6 group/btn disabled:opacity-80"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span className="text-[11px] uppercase tracking-[0.4em] font-black">
                        {initialData ? "Apply Changes" : "Add Coupon"}
                      </span>
                      <ChevronRight className="w-4 h-4 transition-transform duration-500 group-hover/btn:translate-x-2" />
                    </>
                  )}
                </button>
                <Link
                  href="/admin/coupons"
                  className="w-full bg-red-500 block py-4 text-[10px] uppercase tracking-[0.4em] font-black text-center text-white transition-all duration-500"
                >
                  Discard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

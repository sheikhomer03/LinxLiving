"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { useCheckoutStore } from "@/store/useCheckoutStore";

interface StepProps {
  onNext: () => void;
  onBack: () => void;
}

export function CheckoutShipping({ onNext, onBack }: StepProps) {
  const { shippingMethod, setShippingMethod } = useCheckoutStore();

  return (
    <div className="space-y-12 animate-in slide-in-from-right duration-500">
      <div className="space-y-6">
        <div className="flex justify-between items-baseline">
          <h2 className="text-lg font-serif uppercase tracking-widest text-[#333]">
            Shipping Method
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
            Step 2 of 4
          </p>
        </div>

        <div className="space-y-4">
          <label
            className={`flex items-center justify-between p-8 cursor-pointer border-2 ${shippingMethod === "Standard Delivery" ? "border-[#333] bg-white shadow-lg shadow-black/5" : "border-[#333]/10 bg-white/50"} hover:border-[#333]/30 transition-all group relative`}
          >
            <div className="flex items-center gap-6">
              <input
                type="radio"
                name="shipping"
                checked={shippingMethod === "Standard Delivery"}
                onChange={() => setShippingMethod("Standard Delivery")}
                className="w-5 h-5 accent-[#333] cursor-pointer"
              />
              <div className="space-y-1">
                <p className="text-sm font-bold uppercase tracking-widest text-[#333]">
                  Standard Delivery
                </p>
                <p className="text-[11px] opacity-80 font-sans">
                  3-5 Business Days Delivery • Fully Tracked
                </p>
              </div>
            </div>
            <p className="text-sm font-bold italic text-[#333]">Free</p>
          </label>

          <label
            className={`flex items-center justify-between p-8 cursor-pointer border-2 ${shippingMethod === "Express Courier" ? "border-[#333] bg-white shadow-lg shadow-black/5" : "border-[#333]/10 bg-white/50"} hover:border-[#333]/30 transition-all group relative`}
          >
            <div className="flex items-center gap-6">
              <input
                type="radio"
                name="shipping"
                checked={shippingMethod === "Express Courier"}
                onChange={() => setShippingMethod("Express Courier")}
                className="w-5 h-5 accent-[#333] cursor-pointer"
              />
              <div className="space-y-1">
                <p className="text-sm font-bold uppercase tracking-widest text-[#333]">
                  Express Courier
                </p>
                <p className="text-[11px] opacity-80 font-sans">
                  1-2 Business Days Delivery • Premium Handling
                </p>
              </div>
            </div>
            <p className="text-sm font-bold italic text-[#333]">£12.00</p>
          </label>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-10 border-t border-foreground/5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-80 hover:opacity-800 transition-opacity group"
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          Back to Information
        </button>
        <button
          onClick={onNext}
          className="w-full md:w-auto px-12 py-5 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-black/5"
        >
          Continue to Payment
        </button>
      </div>
    </div>
  );
}

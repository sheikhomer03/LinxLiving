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
          <h2 className="text-lg font-serif uppercase tracking-widest text-primary">
            Shipping Method
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/90">
            Step 2 of 4
          </p>
        </div>

        <div className="space-y-4">
          <label
            className={`flex items-center justify-between p-8 cursor-pointer border-2 transition-all duration-500 group relative ${shippingMethod === "Standard Delivery" ? "border-primary bg-white shadow-2xl shadow-primary/10" : "border-foreground/10 bg-white/50 hover:border-primary/30"}`}
          >
            <div className="flex items-center gap-6">
              <input
                type="radio"
                name="shipping"
                checked={shippingMethod === "Standard Delivery"}
                onChange={() => setShippingMethod("Standard Delivery")}
                className="w-5 h-5 accent-primary cursor-pointer"
              />
              <div className="space-y-1">
                <p className="text-sm font-bold uppercase tracking-widest text-foreground">
                  Standard Delivery
                </p>
                <p className="text-[11px] opacity-60 font-sans">
                  3-5 Business Days Delivery • Fully Tracked
                </p>
              </div>
            </div>
            <p className="text-sm font-bold italic text-primary">Free</p>
          </label>

          <label
            className={`flex items-center justify-between p-8 cursor-pointer border-2 transition-all duration-500 group relative ${shippingMethod === "Express Courier" ? "border-primary bg-white shadow-2xl shadow-primary/10" : "border-foreground/10 bg-white/50 hover:border-primary/30"}`}
          >
            <div className="flex items-center gap-6">
              <input
                type="radio"
                name="shipping"
                checked={shippingMethod === "Express Courier"}
                onChange={() => setShippingMethod("Express Courier")}
                className="w-5 h-5 accent-primary cursor-pointer"
              />
              <div className="space-y-1">
                <p className="text-sm font-bold uppercase tracking-widest text-foreground">
                  Express Courier
                </p>
                <p className="text-[11px] opacity-60 font-sans">
                  1-2 Business Days Delivery • Premium Handling
                </p>
              </div>
            </div>
            <p className="text-sm font-bold italic text-primary">£12.00</p>
          </label>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-10 border-t border-foreground/5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-primary/90 hover:text-primary transition-all group"
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          Back to Information
        </button>
        <button
          onClick={onNext}
          className="w-full md:w-auto px-12 py-5 bg-primary text-primary-foreground uppercase tracking-widest text-[11px] font-bold hover:bg-black hover:text-white transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-primary/10"
        >
          Continue to Payment
        </button>
      </div>
    </div>
  );
}

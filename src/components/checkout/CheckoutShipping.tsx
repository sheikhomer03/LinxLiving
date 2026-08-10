"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { useCheckoutStore } from "@/store/useCheckoutStore";
import { useCartStore } from "@/store/useCartStore";
import { STANDARD_DELIVERY, shippingCostFor } from "@/lib/shipping";

interface StepProps {
  onNext: () => void;
  onBack: () => void;
}

export function CheckoutShipping({ onNext, onBack }: StepProps) {
  const { shippingMethod, setShippingMethod, deliveryNotes, setDeliveryNotes } =
    useCheckoutStore();
  // Basket total decides the rate, so this step shows what will be charged.
  const subtotal = useCartStore((s) => s.getTotalPrice());

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
            className={`flex items-center justify-between p-8 cursor-pointer border-2 transition-all duration-500 group relative ${shippingMethod === STANDARD_DELIVERY.method ? "border-primary bg-white shadow-2xl shadow-primary/10" : "border-foreground/10 bg-white/50 hover:border-primary/30"}`}
          >
            <div className="flex items-center gap-6">
              <input
                type="radio"
                name="shipping"
                checked={shippingMethod === STANDARD_DELIVERY.method}
                onChange={() => setShippingMethod(STANDARD_DELIVERY.method)}
                className="w-5 h-5 accent-primary cursor-pointer"
              />
              <div className="space-y-1">
                <p className="text-sm font-bold uppercase tracking-widest text-foreground">
                  {STANDARD_DELIVERY.method}
                </p>
                <p className="text-[11px] opacity-60 font-sans">
                  {STANDARD_DELIVERY.blurb}
                </p>
              </div>
            </div>
            <p className="text-sm font-bold italic text-primary">
              {shippingCostFor(STANDARD_DELIVERY.method, subtotal) === 0
                ? "FREE"
                : `£${STANDARD_DELIVERY.cost.toFixed(2)}`}
            </p>
          </label>
        </div>

        <div className="space-y-3 pt-4">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Delivery notes{" "}
            <span className="opacity-60 normal-case tracking-normal">
              (optional)
            </span>
          </label>
          <textarea
            value={deliveryNotes}
            onChange={(e) => setDeliveryNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Access restrictions, site contact, safe place, delivery window…"
            className="w-full px-4 py-4 bg-secondary/50 text-sm outline-none transition-all focus:bg-white border border-transparent focus:border-primary/25 resize-none"
          />
          <p className="text-[10px] opacity-55">
            Important for large items — tell us about narrow access, parking or
            site hours.
          </p>
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

"use client";

import React, { useState, useEffect } from "react";
import { ChevronLeft, ShieldCheck, Check } from "lucide-react";
import { useCheckoutStore } from "@/store/useCheckoutStore";
import { useCartStore } from "@/store/useCartStore";

interface StepProps {
  onNext: (orderId: string) => void;
  onBack: () => void;
}

export function CheckoutReview({ onNext, onBack }: StepProps) {
  const {
    email,
    shippingAddress,
    billingAddress,
    useShippingAsBilling,
    shippingMethod,
    paymentMethod,
    promoCode,
    discount,
    fixedDiscount,
    discountType,
  } = useCheckoutStore();
  const { items, getTotalPrice } = useCartStore();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  
  useEffect(() => {
    setIsFinishing(false);
  }, []);

  const subtotal = getTotalPrice();
  const shippingCost = shippingMethod === "Express Courier" ? 12 : 0;

  // Calculate discount amount based on type
  const discountAmount =
    discountType === "percentage" ? subtotal * discount : fixedDiscount;

  const total = Math.max(0, subtotal + shippingCost - discountAmount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (acceptedTerms && !isFinishing) {
      setIsFinishing(true);
      try {
        // 1. Create the order in the database first
        const orderResponse = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items,
            totalAmount: total,
            shippingAddress: {
              ...shippingAddress,
              email,
            },
            shippingMethod,
            paymentMethod,
            couponCode: promoCode,
            discountAmount,
          }),
        });

        const orderData = await orderResponse.json();
        if (!orderResponse.ok)
          throw new Error(orderData.error || "Failed to create order");

        if (paymentMethod === "Stripe") {
          // 2. Create Stripe Checkout Session
          const stripeResponse = await fetch("/api/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items,
              orderId: orderData.order._id,
              email,
              discountAmount,
              shippingCost,
              origin: window.location.origin
            }),
          });

          const stripeData = await stripeResponse.json();
          if (stripeResponse.ok && stripeData.url) {
            // Redirect to Stripe Checkout
            window.location.assign(stripeData.url);
          } else {
            throw new Error(
              stripeData.error || "Failed to initiate Stripe Checkout",
            );
          }
        } else {
          // Cash on Delivery - Go straight to success
          onNext(orderData.order._id);
        }
      } catch (error: any) {
        console.error("Order Error:", error);
        alert(error.message);
        setIsFinishing(false);
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-12 animate-in slide-in-from-right duration-500"
    >
      <div className="space-y-8">
        <div className="flex justify-between items-baseline">
          <h2 className="text-xl font-serif uppercase tracking-widest text-primary">
            Review & Confirm
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/90">
            Step 4 of 4
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Information Summary */}
          <div className="p-8 border border-primary/10 bg-secondary/5 space-y-4 shadow-sm">
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-primary/80">
              Contact & Shipping
            </h3>
            <div className="space-y-1">
              <p className="text-sm font-bold text-foreground">
                {shippingAddress.firstName} {shippingAddress.lastName}
              </p>
              <p className="text-xs opacity-60 font-sans">{email}</p>
              <p className="text-xs opacity-60 font-sans">
                {shippingAddress.phone}
              </p>
              <p className="text-xs opacity-60 font-sans pt-2">
                {shippingAddress.address}
                <br />
                {shippingAddress.city}, {shippingAddress.postcode}
                <br />
                {shippingAddress.country}
              </p>
            </div>
          </div>

          {/* Billing & Payment Summary */}
          <div className="p-8 border border-primary/10 bg-secondary/5 space-y-4 shadow-sm">
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-primary/80">
              Billing & Method
            </h3>
            <div className="space-y-1">
              <p className="text-sm font-bold text-foreground">
                {shippingMethod}
              </p>
              <p className="text-xs opacity-60 font-sans mt-2">
                <span className="font-bold">Billing:</span>{" "}
                {useShippingAsBilling
                  ? "Same as shipping"
                  : `${billingAddress.address}, ${billingAddress.city}`}
              </p>
              <p className="text-xs opacity-60 font-sans mt-1">
                <span className="font-bold">Payment:</span> {paymentMethod}
              </p>
              <div className="flex items-center gap-2 pt-4 text-green-600">
                <ShieldCheck className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Protected Purchase
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Final Total Review */}
        <div className="p-8 border-2 border-primary space-y-4 bg-white shadow-2xl shadow-primary/5">
          <div className="flex justify-between items-baseline">
            <span className="text-[10px] uppercase tracking-widest font-bold text-primary/90">
              Total Amount due
            </span>
            <div className="text-right">
              <span className="text-[10px] text-primary/90 mr-2 uppercase font-bold tracking-widest">
                GBP
              </span>
              <span className="text-4xl tracking-tighter font-serif uppercase text-primary">
                £{total.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <label
          className={`flex items-start gap-4 p-8 border-2 transition-all duration-700 ${acceptedTerms ? "border-primary bg-white shadow-2xl shadow-primary/10" : "border-foreground/10 bg-white/50 hover:border-primary/30"} cursor-pointer animate-in slide-in-from-bottom-4`}
        >
          <div className="relative flex items-center justify-center mt-0.5">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="peer w-5 h-5 opacity-0 cursor-pointer z-10"
            />
            <div className="absolute w-5 h-5 border-2 border-primary/20 bg-white peer-checked:bg-primary peer-checked:border-primary transition-all flex items-center justify-center">
              <Check
                className={`w-3 h-3 text-primary-foreground transition-opacity ${acceptedTerms ? "opacity-100" : "opacity-0"}`}
              />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest text-foreground">
              I accept the terms and conditions
            </p>
            <p className="text-[10px] opacity-60 font-sans leading-relaxed">
              By placing this order, you agree to our Terms of Service,
              Privacy Policy, and al service standards. All high-end
              transactions are subject to security verification.
            </p>
          </div>
        </label>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-10 border-t border-foreground/5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-primary/90 hover:text-primary transition-all group"
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          Back to Payment
        </button>
        <button
          type="submit"
          disabled={!acceptedTerms || isFinishing}
          className={`w-full md:w-auto px-20 py-6 bg-primary text-primary-foreground uppercase tracking-widest text-[12px] font-bold transition-all shadow-2xl shadow-primary/20 flex items-center justify-center gap-4 ${!acceptedTerms || isFinishing ? "opacity-50 cursor-not-allowed" : "hover:bg-black hover:text-white hover:scale-[1.02] active:scale-95 translate-y-0 hover:-translate-y-1"}`}
        >
          {isFinishing ? (
            <>
              <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground animate-spin rounded-full" />
              Processing...
            </>
          ) : (
            "Place Order"
          )}
        </button>
      </div>
    </form>
  );
}

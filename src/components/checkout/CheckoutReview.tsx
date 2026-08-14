"use client";

import React, { useState, useEffect } from "react";
import { ChevronLeft, ShieldCheck, Check } from "lucide-react";
import { useCheckoutStore } from "@/store/useCheckoutStore";
import { useCartStore } from "@/store/useCartStore";
import { toast } from "sonner";
import { calculateVat, singleVatRate } from "@/lib/vat";
import { shippingCostFor } from "@/lib/shipping";
import { PaymentMethodTags } from "@/components/common/PaymentMethodTags";
import { CheckoutUnavailableModal } from "@/components/checkout/CheckoutUnavailableModal";
import {
  tradeDiscountAmount,
  isTradeAccount,
  TRADE_DISCOUNT_LABEL,
} from "@/lib/trade";
import { useTradeModeStore } from "@/store/useTradeModeStore";
import { useSession } from "next-auth/react";

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
    deliveryNotes,
  } = useCheckoutStore();
  const { items, getTotalPrice } = useCartStore();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const { data: session } = useSession();
  const tradeModeOn = useTradeModeStore((s) => s.isTradeMode);
  // Real approved trade accounts always get the discount; the no-login
  // toggle (Trade Mode) grants the same reduction without one. The server
  // independently re-derives the account case and accepts this flag for the
  // toggle case — see api/orders and api/checkout.
  const isTrade = isTradeAccount(session?.user) || tradeModeOn;

  useEffect(() => {
    setIsFinishing(false);
  }, []);

  const subtotal = getTotalPrice();
  // Free over the threshold — the basket total decides, so the promise on
  // the storefront is the figure actually charged.
  const shippingCost = shippingCostFor(items, subtotal);

  // Calculate discount amount based on type
  const promoDiscount =
    discountType === "percentage" ? subtotal * discount : fixedDiscount;
  // Trade accounts take a further 5% off the goods total. Product prices are
  // untouched — this is applied once, here, alongside any promo code.
  const tradeDiscount = tradeDiscountAmount(subtotal, isTrade);
  const discountAmount =
    Math.round((promoDiscount + tradeDiscount) * 100) / 100;

  // Prices already include VAT — extracted here for the receipt breakdown.
  const vat = calculateVat({ lines: items, discountAmount, shippingCost });
  const vatRateLabel = singleVatRate(items);
  const total = vat.grandTotal;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (acceptedTerms && !isFinishing) {
      setIsFinishing(true);
      try {
        // Made-to-measure lines carry no Shopify variant — their price comes
        // from the customer's own dimensions, and a Shopify cart line can only
        // charge a variant's price. They now reach Shopify as custom lines on a
        // draft order instead, so they no longer divert to this site's funnel.
        //
        // Cash on Delivery is a choice the customer made, so it is honoured.
        // Everything else goes to Shopify — including a stored "Stripe" from an
        // older session, and regardless of the build-time flag, which is inlined
        // at compile time and has silently dropped customers into the site's own
        // checkout when a bundle was built without it.
        const codChosen = paymentMethod === "Cash on Delivery";
        const useShopify = !codChosen;
        const effectivePayment = codChosen ? "Cash on Delivery" : "Shopify";

        if (useShopify) {
          // Shopify owns payment — order lands in admin via webhook after pay.
          // A dead network throws here, which is exactly the "provider
          // unreachable" case, so it opens the modal rather than bubbling up
          // to the generic toast.
          let shopifyResponse: Response;
          try {
            shopifyResponse = await fetch("/api/checkout/shopify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                items: items.map((i) => ({
                  id: i.id,
                  quantity: i.quantity,
                  shopifyVariantId: i.shopifyVariantId,
                  // `id` carries the chosen option, so the server needs the
                  // product separately to resolve the line.
                  productId: i.productId,
                  configurationSummary: i.configurationSummary,
                  // A made-to-measure line has no variant to price it, so its
                  // name, price and dimensions travel with it and become a
                  // custom line on the draft order.
                  isConfigured: i.isConfigured,
                  name: i.name,
                  price: i.price,
                  configWidthMm: i.configWidthMm,
                  configHeightMm: i.configHeightMm,
                  // Selectors the server re-prices the line against.
                  configKind: i.configKind,
                  configAreaM2: i.configAreaM2,
                  configPacks: i.configPacks,
                  configVariantSku: i.configVariantSku,
                  configPooky: i.configPooky,
                })),
                email,
                promoCode: promoCode || undefined,
              }),
            });
          } catch (networkError: unknown) {
            setCheckoutError(
              networkError instanceof Error && networkError.message
                ? networkError.message
                : "Could not reach the payment provider",
            );
            setIsFinishing(false);
            return;
          }
          const shopifyData = await shopifyResponse.json().catch(() => ({}));
          if (!shopifyResponse.ok || !shopifyData.checkoutUrl) {
            // No fallback to the site's own checkout: that would take an order
            // Shopify never sees, with no payment captured against it.
            setCheckoutError(
              shopifyData.error ||
                `Payment provider unreachable (${shopifyResponse.status})`,
            );
            setIsFinishing(false);
            return;
          }
          // Do NOT clear the cart here — the customer has not paid yet. If they
          // abandon Shopify checkout they must come back to an intact basket.
          // /checkout/complete clears it once payment actually succeeded.
          window.location.assign(shopifyData.checkoutUrl);
          return;
        }

        // 1. Create the order in the database first
        const orderResponse = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items,
            totalAmount: total,
            subtotalExVat: vat.subtotalExVat,
            vatAmount: vat.vatAmount,
            shippingCost,
            shippingAddress: {
              ...shippingAddress,
              email,
            },
            shippingMethod,
            deliveryNotes,
            paymentMethod: effectivePayment,
            couponCode: promoCode,
            // Promo only — the server re-derives the trade discount from the
            // account so it cannot be forged, and adds it itself. Trade Mode
            // has no account to check, so the toggle state is passed through
            // (same trust level as the rest of this checkout body already
            // has — e.g. item prices).
            discountAmount: promoDiscount,
            tradeModeOn,
          }),
        });

        const orderData = await orderResponse.json();
        if (!orderResponse.ok)
          throw new Error(orderData.error || "Failed to create order");

        // Only Cash on Delivery reaches this point — every card payment left
        // for Shopify above, or stopped at the modal. The site no longer opens
        // its own Stripe session: that was the path customers fell into when
        // the Shopify flag was missing from a build, and it took payment
        // outside the store that owns the order. /api/checkout still exists if
        // that decision is ever reversed — it now also accepts `tradeModeOn`.
        onNext(orderData.order._id);
      } catch (error: any) {
        console.error("Order Error:", error);
        toast.error(
          error.message || "We couldn't place your order. Please try again.",
        );
        setIsFinishing(false);
      }
    }
  };

  return (
    <>
    <CheckoutUnavailableModal
      open={Boolean(checkoutError)}
      detail={checkoutError}
      onClose={() => setCheckoutError(null)}
      onRetry={() => {
        setCheckoutError(null);
        handleSubmit(new Event("submit") as unknown as React.FormEvent);
      }}
    />
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
          <div className="space-y-2 pb-4 border-b border-primary/10">
            <div className="flex justify-between text-[11px] tracking-wide opacity-70">
              <span>Subtotal</span>
              <span>£{vat.subtotalExVat.toFixed(2)}</span>
            </div>
            {tradeDiscount > 0 && (
              <div className="flex justify-between text-[11px] tracking-wide text-green-600">
                <span>{TRADE_DISCOUNT_LABEL}</span>
                <span>-£{tradeDiscount.toFixed(2)}</span>
              </div>
            )}
            {promoDiscount > 0 && (
              <div className="flex justify-between text-[11px] tracking-wide text-green-600">
                <span>Discount</span>
                <span>-£{promoDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-[11px] tracking-wide opacity-70">
              <span>Shipping</span>
              <span>
                £{shippingCost.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-[11px] tracking-wide opacity-70">
              <span>incl. VAT{vatRateLabel != null ? ` (${vatRateLabel}%)` : ""}</span>
              <span>£{vat.vatAmount.toFixed(2)}</span>
            </div>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[10px] uppercase tracking-widest font-bold text-primary/90">
              Total Amount due (inc VAT)
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
        {items.some((i) => i.isConfigured) ? (
          <p className="mb-4 text-[11px] leading-relaxed text-foreground/60 font-sans border border-primary/10 bg-secondary/5 p-4">
            Your basket contains a made-to-measure item, cut to your own
            dimensions. Your sizes and options are recorded on the order, and
            payment is taken securely at checkout.
          </p>
        ) : null}
        <PaymentMethodTags className="mb-4" showBlurb />
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
    </>
  );
}

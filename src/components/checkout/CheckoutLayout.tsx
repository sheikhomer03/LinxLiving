import React from "react";
import { useCartStore } from "@/store/useCartStore";
import { useCheckoutStore } from "@/store/useCheckoutStore";
import { Tag } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { calculateVat, singleVatRate } from "@/lib/vat";
import { shippingCostFor } from "@/lib/shipping";
import {
  tradeDiscountAmount,
  isTradeAccount,
  TRADE_DISCOUNT_LABEL,
} from "@/lib/trade";
import { useSession } from "next-auth/react";

interface CheckoutLayoutProps {
  children: React.ReactNode;
  step: 1 | 2 | 3 | 4;
}

export function CheckoutLayout({ children, step }: CheckoutLayoutProps) {
  const { items, getTotalPrice } = useCartStore();
  const {
    promoCode,
    discount,
    fixedDiscount,
    discountType,
    applyPromoCode,
    shippingMethod,
  } = useCheckoutStore();
  const { data: session } = useSession();
  const isTrade = isTradeAccount(session?.user);
  const subtotal = getTotalPrice();
  const [promoInput, setPromoInput] = React.useState(promoCode || "");
  const [isApplying, setIsApplying] = React.useState(false);
  const [couponError, setCouponError] = React.useState<string | null>(null);

  // Free over the threshold — the basket total decides, so the promise on
  // the storefront is the figure actually charged.
  const shippingCost = shippingCostFor(shippingMethod, subtotal);

  // Calculate discount amount based on type
  const promoDiscount =
    discountType === "percentage" ? subtotal * discount : fixedDiscount;
  // Trade accounts take a further 5% off the goods total. Product prices are
  // untouched — this is applied once, here, alongside any promo code.
  const tradeDiscount = tradeDiscountAmount(subtotal, isTrade);
  const discountAmount =
    Math.round((promoDiscount + tradeDiscount) * 100) / 100;

  // Prices already include VAT — this extracts the VAT portion for the
  // breakdown; the total equals the prices shown on the product cards.
  const vat = calculateVat({
    lines: items,
    discountAmount,
    shippingCost,
  });
  const vatRateLabel = singleVatRate(items);
  const total = vat.grandTotal;

  const handleApplyPromo = async () => {
    setIsApplying(true);
    setCouponError(null);
    const result = await applyPromoCode(promoInput, subtotal);
    if (!result.success) {
      setCouponError(result.error || "Failed to apply coupon");
    }
    setIsApplying(false);
  };

  // Re-validate coupon on mount or subtotal change if already present
  // This ensures that coupons are cleared if they no longer meet minimum requirements
  React.useEffect(() => {
    if (promoCode) {
      const revalidate = async () => {
        // Only re-validate if necessary (e.g., if we haven't just manually applied it)
        if (!isApplying) {
          const result = await applyPromoCode(promoCode, subtotal);
          if (!result.success) {
            setCouponError(result.error || "Coupon no longer valid");
          }
        }
      };
      revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  return (
    <div className="min-h-screen bg-white">
      <div className="flex flex-col lg:flex-row pt-20 sm:pt-24 lg:pt-36">
        {/* Main Content */}
        <div className="flex-1 min-w-0 px-4 sm:px-6 lg:px-20 py-8 sm:py-12 lg:py-16 lg:max-w-4xl">
          <header className="mb-8 sm:mb-12">
            <nav className="flex items-center gap-2 sm:gap-4 md:gap-6 text-[9px] sm:text-[10px] uppercase tracking-[0.12em] sm:tracking-[0.15em] font-bold border-b border-foreground/5 pb-4 overflow-x-auto no-scrollbar">
              <span
                className={cn(
                  "py-2 px-2.5 sm:px-4 shrink-0 transition-all duration-500",
                  step >= 1 ? "text-primary-foreground bg-primary shadow-lg shadow-primary/20" : "opacity-40"
                )}
              >
                <span className="sm:hidden">01 Info</span>
                <span className="hidden sm:inline">01 Information</span>
              </span>
              <span className={cn(
                "w-3 sm:w-4 h-px shrink-0 transition-colors duration-500",
                step > 1 ? "bg-primary" : "bg-foreground/10"
              )} />
              <span
                className={cn(
                  "py-2 px-2.5 sm:px-4 shrink-0 transition-all duration-500",
                  step >= 2 ? "text-primary-foreground bg-primary shadow-lg shadow-primary/20" : "opacity-40"
                )}
              >
                <span className="sm:hidden">02 Ship</span>
                <span className="hidden sm:inline">02 Shipping</span>
              </span>
              <span className={cn(
                "w-3 sm:w-4 h-px shrink-0 transition-colors duration-500",
                step > 2 ? "bg-primary" : "bg-foreground/10"
              )} />
              <span
                className={cn(
                  "py-2 px-2.5 sm:px-4 shrink-0 transition-all duration-500",
                  step >= 3 ? "text-primary-foreground bg-primary shadow-lg shadow-primary/20" : "opacity-40"
                )}
              >
                <span className="sm:hidden">03 Pay</span>
                <span className="hidden sm:inline">03 Payment</span>
              </span>
              <span className={cn(
                "w-3 sm:w-4 h-px shrink-0 transition-colors duration-500",
                step > 3 ? "bg-primary" : "bg-foreground/10"
              )} />
              <span className={cn(
                "py-2 px-2.5 sm:px-4 shrink-0 transition-all duration-500",
                step >= 4 ? "text-primary" : "opacity-40"
              )}>
                04 Review
              </span>
            </nav>
          </header>

          {children}
        </div>

        {/* Order summary — stacks under form on mobile; sticky sidebar on desktop */}
        <aside className="w-full lg:w-[500px] bg-secondary/20 px-4 sm:px-6 lg:px-16 py-8 sm:py-12 lg:py-20 border-t lg:border-t-0 lg:border-l border-foreground/5 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
          <div className="space-y-12">
            <div className="pb-6 border-b border-foreground/10">
              <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#333]">
                Order Summary
              </h3>
            </div>

            <div className="divide-y divide-foreground/5 space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex gap-6 py-6 first:pt-0">
                  <div className="relative w-20 h-24 bg-white border border-foreground/5 shrink-0 overflow-hidden group">
                    {item.image?.trim() ? (
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        className="object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-stone-100 to-stone-200" />
                    )}
                    <span className="absolute -top-2 -right-2 bg-[#333] text-white text-[9px] w-6 h-6 flex items-center justify-center rounded-full font-bold shadow-lg">
                      {item.quantity}
                    </span>
                  </div>
                  <div className="flex-1 flex flex-col justify-center gap-2">
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-foreground leading-tight">
                        {item.name}
                      </p>
                      <p className="text-[9px] opacity-60 uppercase tracking-widest italic text-primary">
                        {item.isConfigured ? "Configured" : item.category}
                      </p>
                      {item.configurationSummary ? (
                        <p className="text-[9px] text-muted-foreground leading-snug line-clamp-3 normal-case tracking-normal">
                          {item.configurationSummary}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-[11px] font-bold tracking-tight text-primary">
                      £{(item.price * item.quantity).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-6 pt-10 border-t border-[#333]/10">
              {/* Promo Code Section */}
              <div className="space-y-4">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[#333]">
                  Promo Code
                </p>
                <div className="flex gap-2">
                  <div className="relative input-standard flex-1">
                    <input
                      type="text"
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value)}
                      placeholder="Enter code (e.g. LUXURY10)"
                      className="w-full bg-white px-4 py-3 text-[10px] uppercase tracking-widest transition-all"
                    />
                    <Tag className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 opacity-80" />
                  </div>
                  <button
                    onClick={handleApplyPromo}
                    disabled={isApplying}
                    className="px-6 py-3 bg-primary text-primary-foreground text-[9px] uppercase tracking-[0.2em] font-bold hover:bg-black hover:text-white transition-all disabled:opacity-50 shadow-lg shadow-primary/10"
                  >
                    {isApplying ? "..." : "Apply"}
                  </button>
                </div>
                {couponError && (
                  <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest">
                    {couponError}
                  </p>
                )}
                {promoCode && !couponError && (
                  <p className="text-[9px] text-green-600 font-bold uppercase tracking-widest">
                    Coupon "{promoCode}" applied:{" "}
                    {discountType === "percentage"
                      ? `${(discount * 100).toFixed(0)}%`
                      : `£${fixedDiscount.toFixed(2)}`}{" "}
                    discount
                  </p>
                )}
              </div>

              <div className="space-y-4 pt-6 border-t border-[#333]/5">
                <div className="flex justify-between text-[10px] uppercase tracking-[0.15em] font-bold opacity-80">
                  <span>Subtotal</span>
                  <span>£{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[10px] uppercase tracking-[0.15em] font-bold opacity-80">
                  <span>Shipping</span>
                  <span className="italic">
                    {step === 1
                      ? "Calculated at next step"
                      : `£${shippingCost.toFixed(2)}`}
                  </span>
                </div>
                {tradeDiscount > 0 && (
                  <div className="flex justify-between text-[10px] uppercase tracking-[0.15em] font-bold text-green-600">
                    <span>{TRADE_DISCOUNT_LABEL}</span>
                    <span>-£{tradeDiscount.toFixed(2)}</span>
                  </div>
                )}
                {promoDiscount > 0 && (
                  <div className="flex justify-between text-[10px] uppercase tracking-[0.15em] font-bold text-green-600">
                    <span>Discount</span>
                    <span>-£{promoDiscount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[10px] uppercase tracking-[0.15em] font-bold opacity-80">
                  <span>
                    incl. VAT{vatRateLabel != null ? ` (${vatRateLabel}%)` : ""}
                  </span>
                  <span>£{vat.vatAmount.toFixed(2)}</span>
                </div>
              </div>

              <div className="pt-8 border-t border-primary/20">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-xs uppercase tracking-[0.2em] font-bold text-foreground/80">
                    Total amount
                  </span>
                  <div className="text-right">
                    <span className="text-[10px] opacity-60 mr-2 uppercase font-bold tracking-widest text-primary">
                      GBP
                    </span>
                    <span className="text-3xl tracking-tighter font-serif uppercase text-primary">
                      £{total.toFixed(2)}
                    </span>
                  </div>
                </div>
                <p className="text-[9px] opacity-90 text-right uppercase tracking-widest">
                  Including £{vat.vatAmount.toFixed(2)} VAT
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

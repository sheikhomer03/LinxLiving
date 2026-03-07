import React from "react";
import { useCartStore } from "@/store/useCartStore";
import { useCheckoutStore } from "@/store/useCheckoutStore";
import { Tag } from "lucide-react";
import Image from "next/image";
import { Navbar } from "@/components/layout/Navbar";

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
  const subtotal = getTotalPrice();
  const [promoInput, setPromoInput] = React.useState(promoCode || "");
  const [isApplying, setIsApplying] = React.useState(false);
  const [couponError, setCouponError] = React.useState<string | null>(null);

  const shippingCost = shippingMethod === "Express Courier" ? 12 : 0;

  // Calculate discount amount based on type
  const discountAmount =
    discountType === "percentage" ? subtotal * discount : fixedDiscount;

  const total = Math.max(0, subtotal + shippingCost - discountAmount);

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
      <Navbar />

      <div className="flex flex-col lg:flex-row pt-12 lg:pt-36">
        {/* Main Content */}
        <div className="flex-1 px-6 lg:px-20 py-12 lg:py-16 lg:max-w-4xl">
          <header className="mb-12">
            <nav className="flex items-center gap-6 text-[10px] uppercase tracking-[0.15em] font-bold border-b border-foreground/5 pb-4 overflow-x-auto whitespace-nowrap no-scrollbar">
              <span
                className={
                  step >= 1 ? "text-white py-2 px-4 bg-[#333]" : "opacity-90"
                }
              >
                01 Information
              </span>
              <span className="w-4 h-px bg-foreground/10 shrink-0" />
              <span
                className={
                  step >= 2 ? "text-white py-2 px-4 bg-[#333]" : "opacity-90"
                }
              >
                02 Shipping
              </span>
              <span className="w-4 h-px bg-foreground/10 shrink-0" />
              <span
                className={
                  step >= 3 ? "text-white py-2 px-4 bg-[#333]" : "opacity-90"
                }
              >
                03 Payment
              </span>
              <span className="w-4 h-px bg-foreground/10 shrink-0" />
              <span className={step >= 4 ? "text-[#333]" : "opacity-90"}>
                04 Review
              </span>
            </nav>
          </header>

          {children}
        </div>

        {/* Summary Sidebar - Desktop Only Sticky */}
        <aside className="lg:w-[500px] bg-secondary/20 px-6 lg:px-16 py-12 lg:py-20 border-l border-foreground/5 lg:sticky lg:top-0 h-screen overflow-y-auto">
          <div className="space-y-12">
            <div className="pb-6 border-b border-foreground/10">
              <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#333]">
                Acquisition Summary
              </h3>
            </div>

            <div className="divide-y divide-foreground/5 space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex gap-6 py-6 first:pt-0">
                  <div className="relative w-20 h-24 bg-white border border-foreground/5 shrink-0 overflow-hidden group">
                    <Image
                      src={item.image}
                      alt={item.name}
                      fill
                      className="object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    />
                    <span className="absolute -top-2 -right-2 bg-[#333] text-white text-[9px] w-6 h-6 flex items-center justify-center rounded-full font-bold shadow-lg">
                      {item.quantity}
                    </span>
                  </div>
                  <div className="flex-1 flex flex-col justify-center gap-2">
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-[#333] leading-tight">
                        {item.name}
                      </p>
                      <p className="text-[9px] opacity-80 uppercase tracking-widest italic">
                        {item.category}
                      </p>
                    </div>
                    <p className="text-[11px] font-bold tracking-tight">
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
                    className="px-6 py-3 bg-[#333] text-white text-[9px] uppercase tracking-[0.2em] font-bold hover:bg-black transition-all disabled:opacity-80"
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
                      : shippingCost === 0
                        ? "Gratis"
                        : `£${shippingCost.toFixed(2)}`}
                  </span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-[10px] uppercase tracking-[0.15em] font-bold text-green-600">
                    <span>Discount</span>
                    <span>-£{discountAmount.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="pt-8 border-t border-[#333]/20">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-xs uppercase tracking-[0.2em] font-bold text-[#333]">
                    Total acquisition
                  </span>
                  <div className="text-right">
                    <span className="text-[10px] opacity-80 mr-2 uppercase font-bold tracking-widest">
                      GBP
                    </span>
                    <span className="text-3xl tracking-tighter font-serif uppercase text-[#333]">
                      £{total.toFixed(2)}
                    </span>
                  </div>
                </div>
                <p className="text-[9px] opacity-90 text-right uppercase tracking-widest">
                  Including VAT
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

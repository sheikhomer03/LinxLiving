import { useCheckoutStore } from "@/store/useCheckoutStore";
import { ChevronLeft, CreditCard, Banknote } from "lucide-react";
import { useEffect, useState } from "react";
import { isShopifyCheckoutUiEnabled } from "@/lib/shopify-checkout-public";

interface StepProps {
  onNext: () => void;
  onBack: () => void;
}

export function CheckoutPayment({ onNext, onBack }: StepProps) {
  const {
    useShippingAsBilling,
    setUseShippingAsBilling,
    billingAddress,
    setBillingAddress,
    paymentMethod,
    setPaymentMethod,
  } = useCheckoutStore();

  const [errors, setErrors] = useState<Record<string, string>>({});
  // The build-time flag is only the first guess — it is inlined when the bundle
  // is compiled, so it can disagree with the running server. The server is
  // asked for the truth and wins as soon as it answers.
  const [shopifyCheckout, setShopifyCheckout] = useState(
    isShopifyCheckoutUiEnabled(),
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/checkout/shopify")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.enabled === "boolean") {
          setShopifyCheckout(data.enabled);
        }
      })
      .catch(() => {
        // Unreachable status endpoint says nothing about checkout itself —
        // the review step surfaces a real failure when the order is placed.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (shopifyCheckout && paymentMethod === "Stripe") {
      setPaymentMethod("Shopify");
    }
  }, [shopifyCheckout, paymentMethod, setPaymentMethod]);

  const [billingData, setBillingData] = useState({
    firstName: billingAddress.firstName || "",
    lastName: billingAddress.lastName || "",
    address: billingAddress.address || "",
    city: billingAddress.city || "",
    postcode: billingAddress.postcode || "",
    country: billingAddress.country || "United Kingdom",
  });

  const handleBillingChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setBillingData((prev) => ({ ...prev, [name]: value }));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!useShippingAsBilling) {
      if (!billingData.firstName)
        newErrors.billingFirstName = "FIRST NAME IS REQUIRED";
      if (!billingData.lastName)
        newErrors.billingLastName = "LAST NAME IS REQUIRED";
      if (!billingData.address)
        newErrors.billingAddress = "ADDRESS IS REQUIRED";
      if (!billingData.city) newErrors.billingCity = "CITY IS REQUIRED";
      if (!billingData.postcode)
        newErrors.billingPostcode = "POSTCODE IS REQUIRED";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      if (!useShippingAsBilling) {
        setBillingAddress(billingData);
      }
      onNext();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-12 animate-in slide-in-from-right duration-500"
    >
      <div className="space-y-8">
        <div className="flex justify-between items-baseline">
          <h2 className="text-lg font-serif uppercase tracking-widest text-primary">
            Payment Method
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/90">
            Step 3 of 4
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <label
            className={`flex items-center justify-between p-8 cursor-pointer border-2 transition-all duration-500 group relative ${
              paymentMethod === (shopifyCheckout ? "Shopify" : "Stripe")
                ? "border-primary bg-white shadow-2xl shadow-primary/10"
                : "border-foreground/10 bg-white/50 hover:border-primary/30"
            }`}
          >
            <div className="flex items-center gap-6">
              <div className="relative flex items-center justify-center">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={
                    paymentMethod === (shopifyCheckout ? "Shopify" : "Stripe")
                  }
                  onChange={() =>
                    setPaymentMethod(shopifyCheckout ? "Shopify" : "Stripe")
                  }
                  className="w-5 h-5 accent-primary cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-4 h-4 text-primary" />
                  <p className="text-sm font-bold uppercase tracking-widest text-foreground">
                    Credit / Debit Card
                  </p>
                </div>
                <p className="text-[11px] opacity-80 font-sans">
                  {shopifyCheckout
                    ? "Secure checkout via Shopify • Cards, Shop Pay & more"
                    : "Secure checkout via Stripe • Instant Processing"}
                </p>
              </div>
            </div>
            <div className="hidden md:flex gap-2">
              <div className="w-8 h-5 bg-secondary/20 rounded-sm" />
              <div className="w-8 h-5 bg-secondary/20 rounded-sm" />
              <div className="w-8 h-5 bg-secondary/20 rounded-sm" />
            </div>
          </label>

          <label
            className={`flex items-center justify-between p-8 cursor-pointer border-2 transition-all duration-500 group relative ${
              paymentMethod === "Cash on Delivery"
                ? "border-primary bg-white shadow-2xl shadow-primary/10"
                : "border-foreground/10 bg-white/50 hover:border-primary/30"
            }`}
          >
            <div className="flex items-center gap-6">
              <div className="relative flex items-center justify-center">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === "Cash on Delivery"}
                  onChange={() => setPaymentMethod("Cash on Delivery")}
                  className="w-5 h-5 accent-primary cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <Banknote className="w-4 h-4 text-primary" />
                  <p className="text-sm font-bold uppercase tracking-widest text-foreground">
                    Cash on Delivery
                  </p>
                </div>
                <p className="text-[11px] opacity-80 font-sans">
                  Pay with cash upon arrival • Subject to verification
                </p>
              </div>
            </div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-primary italic">
              COD
            </p>
          </label>
        </div>
      </div>

      <div className="space-y-6">
        <h2 className="text-lg font-serif uppercase tracking-widest text-primary">
          Billing Address
        </h2>
        <div className="space-y-6">
          <label
            className={`flex items-center gap-4 p-8 border-2 transition-all duration-500 ${
              useShippingAsBilling
                ? "border-primary bg-white shadow-2xl shadow-primary/10"
                : "border-foreground/10 bg-white/50 hover:border-primary/30"
            } cursor-pointer group`}
          >
            <input
              type="checkbox"
              checked={useShippingAsBilling}
              onChange={(e) => setUseShippingAsBilling(e.target.checked)}
              className="w-5 h-5 accent-primary cursor-pointer"
            />
            <span className="text-xs font-bold uppercase tracking-widest text-foreground">
              Same as shipping address
            </span>
          </label>

          {!useShippingAsBilling && (
            <div className="p-8 border-2 border-[#333]/10 bg-secondary/5 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  className={`input-standard transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 ${errors.billingFirstName ? "border-red-500!" : ""}`}
                >
                  <input
                    type="text"
                    name="firstName"
                    value={billingData.firstName}
                    onChange={handleBillingChange}
                    placeholder="First Name"
                    className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
                  />
                </div>
                <div
                  className={`input-standard transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 ${errors.billingLastName ? "border-red-500!" : ""}`}
                >
                  <input
                    type="text"
                    name="lastName"
                    value={billingData.lastName}
                    onChange={handleBillingChange}
                    placeholder="Last Name"
                    className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
                  />
                </div>
              </div>
              <div
                className={`input-standard transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 ${errors.billingAddress ? "border-red-500!" : ""}`}
              >
                <input
                  type="text"
                  name="address"
                  value={billingData.address}
                  onChange={handleBillingChange}
                  placeholder="Address"
                  className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  className={`input-standard transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 ${errors.billingCity ? "border-red-500!" : ""}`}
                >
                  <input
                    type="text"
                    name="city"
                    value={billingData.city}
                    onChange={handleBillingChange}
                    placeholder="City"
                    className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
                  />
                </div>
                <div
                  className={`input-standard transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 ${errors.billingPostcode ? "border-red-500!" : ""}`}
                >
                  <input
                    type="text"
                    name="postcode"
                    value={billingData.postcode}
                    onChange={handleBillingChange}
                    placeholder="Postcode"
                    className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-10 border-t border-foreground/5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-primary/90 hover:text-primary transition-all group"
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          Back to Shipping
        </button>
        <button
          type="submit"
          className="w-full md:w-auto px-16 py-5 bg-primary text-primary-foreground uppercase tracking-widest text-[11px] font-bold transition-all shadow-xl shadow-primary/10 flex items-center justify-center gap-4 hover:bg-black hover:text-white hover:scale-[1.02] active:scale-95"
        >
          Continue to Review
        </button>
      </div>
    </form>
  );
}

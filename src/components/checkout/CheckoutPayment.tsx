import { useCheckoutStore } from "@/store/useCheckoutStore";
import { ChevronLeft, CreditCard, Banknote } from "lucide-react";
import { useState } from "react";

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

  const [isProcessing, setIsProcessing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
      setIsProcessing(true);
      setTimeout(() => {
        setIsProcessing(false);
        onNext();
      }, 800);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-12 animate-in slide-in-from-right duration-500"
    >
      <div className="space-y-8">
        <div className="flex justify-between items-baseline">
          <h2 className="text-lg font-serif uppercase tracking-widest text-[#333]">
            Payment Method
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">
            Step 3 of 4
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <label
            className={`flex items-center justify-between p-8 cursor-pointer border-2 transition-all ${
              paymentMethod === "Stripe"
                ? "border-[#333] bg-white shadow-lg shadow-black/5"
                : "border-[#333]/10 bg-white/50"
            } hover:border-[#333]/30 group relative`}
          >
            <div className="flex items-center gap-6">
              <div className="relative flex items-center justify-center">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === "Stripe"}
                  onChange={() => setPaymentMethod("Stripe")}
                  className="w-5 h-5 accent-[#333] cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-4 h-4 opacity-40" />
                  <p className="text-sm font-bold uppercase tracking-widest text-[#333]">
                    Credit / Debit Card
                  </p>
                </div>
                <p className="text-[11px] opacity-40 font-sans">
                  Secure checkout via Stripe • Instant Processing
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
            className={`flex items-center justify-between p-8 cursor-pointer border-2 transition-all ${
              paymentMethod === "Cash on Delivery"
                ? "border-[#333] bg-white shadow-lg shadow-black/5"
                : "border-[#333]/10 bg-white/50"
            } hover:border-[#333]/30 group relative`}
          >
            <div className="flex items-center gap-6">
              <div className="relative flex items-center justify-center">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === "Cash on Delivery"}
                  onChange={() => setPaymentMethod("Cash on Delivery")}
                  className="w-5 h-5 accent-[#333] cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <Banknote className="w-4 h-4 opacity-40" />
                  <p className="text-sm font-bold uppercase tracking-widest text-[#333]">
                    Cash on Delivery
                  </p>
                </div>
                <p className="text-[11px] opacity-40 font-sans">
                  Pay with cash upon arrival • Subject to verification
                </p>
              </div>
            </div>
            <p className="text-[10px] uppercase font-bold tracking-widest opacity-40 italic">
              COD
            </p>
          </label>
        </div>
      </div>

      <div className="space-y-6">
        <h2 className="text-lg font-serif uppercase tracking-widest text-[#333]">
          Billing Address
        </h2>
        <div className="space-y-6">
          <label
            className={`flex items-center gap-4 p-8 border-2 ${
              useShippingAsBilling
                ? "border-[#333] shadow-lg shadow-black/5"
                : "border-[#333]/10"
            } cursor-pointer bg-white group hover:border-[#333]/30 transition-all`}
          >
            <input
              type="checkbox"
              checked={useShippingAsBilling}
              onChange={(e) => setUseShippingAsBilling(e.target.checked)}
              className="w-5 h-5 accent-[#333] cursor-pointer"
            />
            <span className="text-xs font-bold uppercase tracking-widest text-[#333]">
              Same as shipping address
            </span>
          </label>

          {!useShippingAsBilling && (
            <div className="p-8 border-2 border-[#333]/10 bg-secondary/5 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  name="firstName"
                  value={billingData.firstName}
                  onChange={handleBillingChange}
                  placeholder="First Name"
                  className={`w-full border ${
                    errors.billingFirstName
                      ? "border-red-500"
                      : "border-foreground/10"
                  } px-4 py-4 text-sm focus:outline-none focus:border-[#333] transition-all bg-white placeholder:text-foreground/30`}
                />
                <input
                  type="text"
                  name="lastName"
                  value={billingData.lastName}
                  onChange={handleBillingChange}
                  placeholder="Last Name"
                  className={`w-full border ${
                    errors.billingLastName
                      ? "border-red-500"
                      : "border-foreground/10"
                  } px-4 py-4 text-sm focus:outline-none focus:border-[#333] transition-all bg-white placeholder:text-foreground/30`}
                />
              </div>
              <input
                type="text"
                name="address"
                value={billingData.address}
                onChange={handleBillingChange}
                placeholder="Address"
                className={`w-full border ${
                  errors.billingAddress
                    ? "border-red-500"
                    : "border-foreground/10"
                } px-4 py-4 text-sm focus:outline-none focus:border-[#333] transition-all bg-white placeholder:text-foreground/30`}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  name="city"
                  value={billingData.city}
                  onChange={handleBillingChange}
                  placeholder="City"
                  className={`w-full border ${
                    errors.billingCity
                      ? "border-red-500"
                      : "border-foreground/10"
                  } px-4 py-4 text-sm focus:outline-none focus:border-[#333] transition-all bg-white placeholder:text-foreground/30`}
                />
                <input
                  type="text"
                  name="postcode"
                  value={billingData.postcode}
                  onChange={handleBillingChange}
                  placeholder="Postcode"
                  className={`w-full border ${
                    errors.billingPostcode
                      ? "border-red-500"
                      : "border-foreground/10"
                  } px-4 py-4 text-sm focus:outline-none focus:border-[#333] transition-all bg-white placeholder:text-foreground/30`}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-10 border-t border-foreground/5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity group"
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          Back to Shipping
        </button>
        <button
          type="submit"
          disabled={isProcessing}
          className={`w-full md:w-auto px-16 py-5 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold transition-all shadow-xl shadow-black/5 flex items-center justify-center gap-4 ${
            isProcessing
              ? "opacity-80 cursor-wait"
              : "hover:bg-black hover:scale-[1.02] active:scale-95"
          }`}
        >
          {isProcessing ? (
            <>
              <div className="w-4 h-4 border-2 border-white/20 border-t-white animate-spin rounded-full" />
              Processing...
            </>
          ) : (
            "Continue to Review"
          )}
        </button>
      </div>
    </form>
  );
}

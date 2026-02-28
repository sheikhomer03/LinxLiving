import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Address {
  firstName: string;
  lastName: string;
  company?: string;
  address: string;
  address2?: string;
  city: string;
  county?: string;
  postcode: string;
  country: string;
}

interface CheckoutState {
  email: string;
  shippingAddress: Address;
  billingAddress: Address;
  useShippingAsBilling: boolean;
  shippingMethod: string;
  paymentMethod: "Stripe" | "Cash on Delivery";
  promoCode: string;
  discount: number;

  setEmail: (email: string) => void;
  setShippingAddress: (address: Partial<Address>) => void;
  setBillingAddress: (address: Partial<Address>) => void;
  setUseShippingAsBilling: (value: boolean) => void;
  setShippingMethod: (method: string) => void;
  setPaymentMethod: (method: "Stripe" | "Cash on Delivery") => void;
  applyPromoCode: (code: string) => void;
  clearCheckout: () => void;
}

const initialAddress: Address = {
  firstName: "",
  lastName: "",
  address: "",
  city: "",
  postcode: "",
  country: "United Kingdom",
};

export const useCheckoutStore = create<CheckoutState>()(
  persist(
    (set) => ({
      email: "",
      shippingAddress: { ...initialAddress },
      billingAddress: { ...initialAddress },
      useShippingAsBilling: true,
      shippingMethod: "Standard Delivery",
      paymentMethod: "Stripe",
      promoCode: "",
      discount: 0,

      setEmail: (email) => set({ email }),
      setShippingAddress: (address) =>
        set((state) => ({
          shippingAddress: { ...state.shippingAddress, ...address },
        })),
      setBillingAddress: (address) =>
        set((state) => ({
          billingAddress: { ...state.billingAddress, ...address },
        })),
      setUseShippingAsBilling: (useShippingAsBilling) =>
        set({ useShippingAsBilling }),
      setShippingMethod: (shippingMethod) => set({ shippingMethod }),
      setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
      applyPromoCode: (promoCode) => {
        // Simulated promo code logic
        if (promoCode.toUpperCase() === "LINXLIVING10") {
          set({ promoCode, discount: 0.1 });
        } else {
          set({ promoCode: "", discount: 0 });
        }
      },
      clearCheckout: () =>
        set({
          email: "",
          shippingAddress: { ...initialAddress },
          billingAddress: { ...initialAddress },
          useShippingAsBilling: true,
          shippingMethod: "Standard Delivery",
          paymentMethod: "Stripe",
          promoCode: "",
          discount: 0,
        }),
    }),
    {
      name: "checkout-storage",
    },
  ),
);

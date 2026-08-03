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
  phone?: string;
}

interface CheckoutState {
  email: string;
  shippingAddress: Address;
  billingAddress: Address;
  useShippingAsBilling: boolean;
  shippingMethod: string;
  paymentMethod: "Stripe" | "Shopify" | "Cash on Delivery";
  /** Customer delivery/access instructions */
  deliveryNotes: string;
  promoCode: string;
  discount: number; // For percentage
  fixedDiscount: number; // For fixed amount
  discountType: "percentage" | "fixed" | null;

  setEmail: (email: string) => void;
  setShippingAddress: (address: Partial<Address>) => void;
  setBillingAddress: (address: Partial<Address>) => void;
  setUseShippingAsBilling: (value: boolean) => void;
  setShippingMethod: (method: string) => void;
  setPaymentMethod: (
    method: "Stripe" | "Shopify" | "Cash on Delivery",
  ) => void;
  setDeliveryNotes: (notes: string) => void;
  applyPromoCode: (
    code: string,
    subtotal: number,
  ) => Promise<{ success: boolean; error?: string }>;
  clearCheckout: () => void;
}

const initialAddress: Address = {
  firstName: "",
  lastName: "",
  address: "",
  city: "",
  postcode: "",
  country: "United Kingdom",
  phone: "",
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
      deliveryNotes: "",
      promoCode: "",
      discount: 0,
      fixedDiscount: 0,
      discountType: null,

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
      setDeliveryNotes: (deliveryNotes) => set({ deliveryNotes }),
      applyPromoCode: async (code, subtotal) => {
        if (!code) {
          set({
            promoCode: "",
            discount: 0,
            fixedDiscount: 0,
            discountType: null,
          });
          return { success: false, error: "Please enter a code" };
        }

        try {
          const { validateCoupon } = await import("@/app/actions/coupons");
          const result = await validateCoupon(code, subtotal);

          if (result.success) {
            const coupon = result.coupon;

            set({
              promoCode: coupon.code,
              discount:
                coupon.discountType === "percentage"
                  ? coupon.discountAmount / 100
                  : 0,
              fixedDiscount:
                coupon.discountType === "fixed" ? coupon.discountAmount : 0,
              discountType: coupon.discountType,
            });
            return { success: true };
          } else {
            set({
              promoCode: "",
              discount: 0,
              fixedDiscount: 0,
              discountType: null,
            });
            return { success: false, error: result.error };
          }
        } catch (error) {
          set({
            promoCode: "",
            discount: 0,
            fixedDiscount: 0,
            discountType: null,
          });
          return { success: false, error: "Failed to validate coupon" };
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
          deliveryNotes: "",
          promoCode: "",
          discount: 0,
          fixedDiscount: 0,
          discountType: null,
        }),
    }),
    {
      name: "checkout-storage",
    },
  ),
);

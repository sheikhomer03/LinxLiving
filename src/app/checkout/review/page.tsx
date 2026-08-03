"use client";

import { CheckoutLayout } from "@/components/checkout/CheckoutLayout";
import { CheckoutReview } from "@/components/checkout/CheckoutReview";
import { CheckoutGuardFallback } from "@/components/checkout/CheckoutGuardFallback";
import { useCheckoutGuard } from "@/hooks/useCheckoutGuard";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/store/useCartStore";
import { useCheckoutStore } from "@/store/useCheckoutStore";

export default function ReviewPage() {
  const router = useRouter();
  const clearCart = useCartStore((state) => state.clearCart);
  const clearCheckout = useCheckoutStore((state) => state.clearCheckout);
  const ready = useCheckoutGuard(4);

  const handleComplete = (orderId: string) => {
    clearCart();
    clearCheckout();
    router.push(`/checkout/success/${orderId}`);
  };

  if (!ready) return <CheckoutGuardFallback />;

  return (
    <CheckoutLayout step={4}>
      <CheckoutReview
        onNext={handleComplete}
        onBack={() => router.push("/checkout/payment")}
      />
    </CheckoutLayout>
  );
}

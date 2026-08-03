"use client";

import { CheckoutLayout } from "@/components/checkout/CheckoutLayout";
import { CheckoutPayment } from "@/components/checkout/CheckoutPayment";
import { CheckoutGuardFallback } from "@/components/checkout/CheckoutGuardFallback";
import { useCheckoutGuard } from "@/hooks/useCheckoutGuard";
import { useRouter } from "next/navigation";

export default function PaymentPage() {
  const router = useRouter();
  const ready = useCheckoutGuard(3);

  if (!ready) return <CheckoutGuardFallback />;

  return (
    <CheckoutLayout step={3}>
      <CheckoutPayment
        onNext={() => router.push("/checkout/review")}
        onBack={() => router.push("/checkout/shipping")}
      />
    </CheckoutLayout>
  );
}

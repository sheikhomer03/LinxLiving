"use client";

import { CheckoutLayout } from "@/components/checkout/CheckoutLayout";
import { CheckoutShipping } from "@/components/checkout/CheckoutShipping";
import { CheckoutGuardFallback } from "@/components/checkout/CheckoutGuardFallback";
import { useCheckoutGuard } from "@/hooks/useCheckoutGuard";
import { useRouter } from "next/navigation";

export default function ShippingPage() {
  const router = useRouter();
  const ready = useCheckoutGuard(2);

  if (!ready) return <CheckoutGuardFallback />;

  return (
    <CheckoutLayout step={2}>
      <CheckoutShipping
        onNext={() => router.push("/checkout/payment")}
        onBack={() => router.push("/checkout/information")}
      />
    </CheckoutLayout>
  );
}

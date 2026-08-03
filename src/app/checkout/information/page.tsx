"use client";

import { CheckoutLayout } from "@/components/checkout/CheckoutLayout";
import { CheckoutInformation } from "@/components/checkout/CheckoutInformation";
import { CheckoutGuardFallback } from "@/components/checkout/CheckoutGuardFallback";
import { useCheckoutGuard } from "@/hooks/useCheckoutGuard";
import { useRouter } from "next/navigation";

export default function InformationPage() {
  const router = useRouter();
  const ready = useCheckoutGuard(1);

  if (!ready) return <CheckoutGuardFallback />;

  return (
    <CheckoutLayout step={1}>
      <CheckoutInformation onNext={() => router.push("/checkout/shipping")} />
    </CheckoutLayout>
  );
}

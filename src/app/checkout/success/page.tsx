"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Orphaned success route.
 *
 * Real confirmations land on /checkout/success/[orderId]. This page previously
 * invented a random order reference, which showed customers a number that
 * matched no order and changed on every refresh. Reaching it without an order
 * id means we have nothing to confirm, so send the customer somewhere useful.
 */
export default function OrderSuccessRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/track-order");
  }, [router]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-[#333]/20 border-t-[#333] animate-spin rounded-full" />
    </div>
  );
}

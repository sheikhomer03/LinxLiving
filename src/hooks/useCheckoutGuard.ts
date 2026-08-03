"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/store/useCartStore";
import { useCheckoutStore } from "@/store/useCheckoutStore";

/**
 * Guards a checkout step.
 *
 * Two things must hold before a step may render:
 *  1. the cart is not empty — otherwise the customer can reach Review and
 *     place a £0.00 order;
 *  2. every earlier step has been completed — otherwise an order can be
 *     created with a blank shipping address.
 *
 * Both stores are persisted to localStorage, so we wait for hydration before
 * deciding; checking too early would bounce a legitimate customer back.
 */
export function useCheckoutGuard(step: 1 | 2 | 3 | 4) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const items = useCartStore((s) => s.items);
  const email = useCheckoutStore((s) => s.email);
  const shippingAddress = useCheckoutStore((s) => s.shippingAddress);
  const shippingMethod = useCheckoutStore((s) => s.shippingMethod);

  useEffect(() => {
    // Defer one tick so persisted stores have rehydrated.
    const timer = setTimeout(() => {
      if (!items || items.length === 0) {
        router.replace("/cart");
        return;
      }

      const informationDone = Boolean(
        email &&
          shippingAddress?.firstName &&
          shippingAddress?.lastName &&
          shippingAddress?.address &&
          shippingAddress?.city &&
          shippingAddress?.postcode,
      );

      if (step >= 2 && !informationDone) {
        router.replace("/checkout/information");
        return;
      }

      if (step >= 3 && !shippingMethod) {
        router.replace("/checkout/shipping");
        return;
      }

      setReady(true);
    }, 0);

    return () => clearTimeout(timer);
  }, [items, email, shippingAddress, shippingMethod, step, router]);

  return ready;
}

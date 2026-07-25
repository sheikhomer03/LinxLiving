"use client";

import { useCartStore } from "@/store/useCartStore";

/**
 * Shows stock minus units currently in this shopper's cart — updates live.
 */
export function ProductAvailability({
  productId,
  initialStock,
}: {
  productId: string;
  initialStock: number;
}) {
  const cartQty = useCartStore((s) => s.getCartQuantity(productId));
  const available = Math.max(0, (initialStock || 0) - cartQty);
  const inStock = available > 0;

  return (
    <div className="bg-secondary/30 p-8 space-y-4 border border-foreground/5">
      <p className="text-[10px] uppercase tracking-widest font-bold">
        Availability
      </p>
      <div className="flex items-center space-x-3">
        <div
          className={`w-2 h-2 rounded-full ${inStock ? "bg-green-500" : "bg-red-500"}`}
        />
        <p className="text-xs uppercase tracking-widest">
          {inStock
            ? `In Stock (${available}) - Ready for immediate dispatch`
            : cartQty > 0
              ? "All available units are in your cart"
              : "Currently Out of Stock"}
        </p>
      </div>
      {cartQty > 0 ? (
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {cartQty} reserved in your cart
        </p>
      ) : null}
    </div>
  );
}

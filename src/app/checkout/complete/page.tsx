"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useCartStore } from "@/store/useCartStore";
import { useCheckoutStore } from "@/store/useCheckoutStore";

/**
 * Landing page after Shopify Checkout (optional).
 * Orders sync into admin via Shopify webhooks / pull — not created here.
 */
export default function ShopifyCheckoutCompletePage() {
  const clearCart = useCartStore((s) => s.clearCart);
  const clearCheckout = useCheckoutStore((s) => s.clearCheckout);

  useEffect(() => {
    clearCart();
    clearCheckout();
  }, [clearCart, clearCheckout]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-6 py-24">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
          </div>
          <div className="space-y-3">
            <h1 className="font-serif text-3xl uppercase tracking-[0.12em]">
              Thank you
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              If you completed payment on Shopify, your order is confirmed.
              It will appear in our admin shortly (and in your email from
              Shopify).
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link
              href="/products"
              className="w-full py-4 bg-primary text-primary-foreground text-[10px] uppercase tracking-[0.22em] font-bold hover:bg-black hover:text-white transition-colors"
            >
              Continue shopping
            </Link>
            <Link
              href="/track-order"
              className="w-full py-3 text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-foreground transition-colors"
            >
              Track an order
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

"use client";

import React from "react";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useCheckoutStore } from "@/store/useCheckoutStore";

export default function OrderSuccessPage() {
  const clearCheckout = useCheckoutStore((state) => state.clearCheckout);
  const orderNumber =
    "AUREL-" + Math.random().toString(36).toUpperCase().substring(2, 8);

  return (
    <main className="min-h-screen bg-white flex flex-col">
      <Navbar />

      <section className="flex-1 flex items-center justify-center px-6 pt-32 pb-20">
        <div className="max-w-md w-full text-center space-y-12 animate-in fade-in zoom-in duration-1000">
          <div className="flex flex-col items-center gap-6">
            <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center shadow-sm">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-serif uppercase tracking-widest text-[#333]">
                Acquired
              </h1>
              <p className="text-sm text-[#333]/60 font-sans tracking-wide leading-relaxed">
                Your selection has been finalized. A confirmation of your
                acquisition has been sent to your registered address.
              </p>
            </div>
          </div>

          <div className="p-8 border border-foreground/5 bg-secondary/10 space-y-4 text-left">
            <div className="flex justify-between items-center text-[10px] uppercase tracking-widest font-bold opacity-40">
              <span>Order Reference</span>
              <span>{orderNumber}</span>
            </div>
            <p className="text-[11px] font-sans italic opacity-60">
              Thank you for choosing Linx Living. Our s are now preparing your
              collection for delivery.
            </p>
          </div>

          <Link
            href="/"
            onClick={() => clearCheckout()}
            className="inline-block px-16 py-5 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-black/10"
          >
            Return to Atelier
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}

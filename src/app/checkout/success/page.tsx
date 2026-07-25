"use client";

import React from "react";
import { Check, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useCheckoutStore } from "@/store/useCheckoutStore";
import { getStoreName } from "@/app/actions/settings";
import { useEffect, useState } from "react";

export default function OrderSuccessPage() {
  const clearCheckout = useCheckoutStore((state) => state.clearCheckout);
  const [storeName, setStoreName] = useState("Linx Square");

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);
  const orderNumber =
    "AUREL-" + Math.random().toString(36).toUpperCase().substring(2, 8);

  return (
    <main className="min-h-screen bg-white flex flex-col font-sans">
      <Navbar />

      <section className="flex-1 flex items-center justify-center px-6 pt-32 pb-20">
        <div className="max-w-2xl w-full text-center space-y-12 animate-in fade-in zoom-in duration-700">
          <div className="flex flex-col items-center gap-6">
            <div className="w-24 h-24 bg-primary rounded-full flex items-center justify-center animate-bounce shadow-2xl shadow-primary/20">
              <Check className="w-12 h-12 text-primary" />
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-serif uppercase tracking-[0.3em] text-primary">
                Acquired
              </h1>
              <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-foreground/80 italic leading-relaxed max-w-[280px] mx-auto">
                Your selection has been finalized. A confirmation of your
                acquisition has been dispatched.
              </p>
            </div>
          </div>

          <div className="p-10 border border-primary/20 bg-white/80 backdrop-blur-sm shadow-2xl shadow-primary/10 space-y-8 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity">
              <ShoppingBag className="w-48 h-48 text-primary" />
            </div>

            <div className="relative space-y-6">
              <div className="flex flex-col items-center gap-1">
                <p className="text-[10px] uppercase tracking-widest font-bold text-primary/90">
                  Order Reference
                </p>
                <p className="text-2xl font-serif tracking-tighter text-foreground">
                  {orderNumber}
                </p>
              </div>

              <div className="h-px bg-primary/10 w-full" />

              <div className="grid grid-cols-2 gap-8 text-center pt-2">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-primary/90">
                    Status
                  </p>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
                    In Atelier
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-primary/90">
                    Arrival Est.
                  </p>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
                    3-5 Days
                  </p>
                </div>
              </div>

              <div className="pt-4">
                <p className="text-[11px] italic opacity-80 font-serif max-w-sm mx-auto text-primary">
                  "Thank you for choosing {storeName}. Our master artisans are
                  now preparing your collection for transit."
                </p>
              </div>
            </div>
          </div>

          <div className="pt-8">
            <Link
              href="/"
              onClick={() => clearCheckout()}
              className="inline-block px-20 py-5 bg-primary text-primary-foreground uppercase tracking-widest text-[11px] font-bold hover:bg-black hover:text-white transition-all hover:scale-[1.05] active:scale-95 shadow-2xl shadow-primary/20"
            >
              Return to Atelier
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

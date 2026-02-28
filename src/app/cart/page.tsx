"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, X } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

export default function CartPage() {
  const { items, updateQuantity, removeItem, getTotalPrice } = useCartStore();
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <main className="min-h-screen">
        <Navbar />
        <div className="pt-40 h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground animate-spin rounded-full" />
        </div>
      </main>
    );
  }

  const subtotal = getTotalPrice();

  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title="Your Collection"
        description="Review your selected materials and al pieces before proceeding to checkout."
        breadcrumb={[{ label: "Cart", href: "/cart" }]}
      />

      <section className="py-24 px-6 lg:px-20 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-20">
          {/* Items */}
          <div className="lg:col-span-8 space-y-12">
            {items.length > 0 ? (
              items.map((item) => (
                <div
                  key={item.id}
                  className="group relative flex flex-col sm:flex-row gap-8 pb-12 border-b"
                >
                  <div className="relative aspect-4/5 w-full sm:w-48 overflow-hidden bg-secondary shrink-0">
                    <Image
                      src={item.image}
                      alt={item.name}
                      fill
                      className="object-cover grayscale"
                    />
                  </div>

                  <div className="flex-1 flex flex-col justify-between py-2">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <p className="uppercase tracking-widest text-[10px] font-bold opacity-40">
                          {item.category}
                        </p>
                        <h3 className="text-2xl font-serif tracking-tight uppercase">
                          {item.name}
                        </h3>
                      </div>
                      <button
                        onClick={() => {
                          removeItem(item.id);
                          toast.error(`${item.name} removed from collection`);
                        }}
                        className="p-2 opacity-40 hover:opacity-100 transition-opacity"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex justify-between items-center mt-8">
                      <div className="flex items-center border border-foreground/10 px-4 py-2 gap-6">
                        <button
                          onClick={() =>
                            updateQuantity(item.id, item.quantity - 1)
                          }
                          className="opacity-40 hover:opacity-100 transition-opacity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-bold w-4 text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() =>
                            updateQuantity(item.id, item.quantity + 1)
                          }
                          className="opacity-40 hover:opacity-100 transition-opacity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-lg tracking-tight">
                        ${(item.price * item.quantity).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-40 border border-dashed flex flex-col items-center gap-8">
                <p className="uppercase tracking-[0.4em] text-[10px] font-bold opacity-40">
                  Your collection is currently empty
                </p>
                <Link
                  href="/tiles"
                  className="px-10 py-4 bg-foreground text-background uppercase tracking-widest text-[10px] font-bold hover:bg-accent hover:text-foreground transition-all"
                >
                  Browse Materials
                </Link>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="lg:col-span-4 lg:sticky lg:top-40 h-fit bg-secondary/30 p-10 space-y-10">
            <h3 className="text-sm font-bold uppercase tracking-[0.4em] pb-6 border-b border-foreground/10">
              Order Summary
            </h3>

            <div className="space-y-6">
              <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-40">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-40">
                <span>Tax (Inclusive)</span>
                <span>${(subtotal * 0.2).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-40">
                <span>Delivery</span>
                <span className="italic">Calculated at next step</span>
              </div>
            </div>

            <div className="pt-10 border-t border-foreground/10">
              <div className="flex justify-between items-baseline mb-10">
                <span className="uppercase tracking-widest text-[10px] font-bold">
                  Total Est.
                </span>
                <span className="text-3xl tracking-tight">
                  ${subtotal.toFixed(2)}
                </span>
              </div>
              <Link
                href={session ? "/checkout" : "/login"}
                onClick={() => {
                  if (!session) {
                    toast.error("Please login to proceed to checkout");
                  }
                }}
                className="w-full bg-foreground text-background py-5 uppercase tracking-widest text-[10px] font-bold hover:bg-accent hover:text-foreground transition-all flex items-center justify-center"
              >
                {session ? "Proceed to Checkout" : "Login to Checkout"}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

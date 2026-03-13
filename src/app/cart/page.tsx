"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, X, AlertCircle } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

export default function CartPage() {
  const { items, updateQuantity, removeItem, getTotalPrice } = useCartStore();
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();

  // Modal states
  const [itemToDelete, setItemToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);

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
        title="Your Cart"
        description="Review your selected materials and al pieces before proceeding to checkout."
        breadcrumb={[{ label: "Cart", href: "/cart" }]}
      />

      <section className="py-10 px-6 lg:px-20 max-w-7xl mx-auto">
        <div
          className={cn(
            "grid grid-cols-1 gap-20",
            items.length > 0 ? "lg:grid-cols-12" : "max-w-3xl mx-auto w-full",
          )}
        >
          {/* Items */}
          <div
            className={cn(
              "space-y-12",
              items.length > 0 ? "lg:col-span-8" : "",
            )}
          >
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
                        <p className="uppercase tracking-[0.2em] text-[10px] font-bold text-primary">
                          {item.category}
                        </p>
                        <h3 className="text-2xl font-serif tracking-tight uppercase text-foreground/90">
                          {item.name}
                        </h3>
                      </div>
                      <button
                        onClick={() =>
                          setItemToDelete({ id: item.id, name: item.name })
                        }
                        className="p-2 opacity-80 hover:opacity-800 transition-opacity"
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
                          className="opacity-80 hover:opacity-800 transition-opacity"
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
                          className="opacity-80 hover:opacity-800 transition-opacity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-lg font-bold tracking-tight text-primary">
                        £
                        {(item.price * item.quantity).toLocaleString("en-GB", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in duration-700">
                <div className="w-24 h-24 bg-primary/10 flex items-center justify-center rounded-full">
                  <AlertCircle className="w-10 h-10 text-primary opacity-90" />
                </div>
                <div className="space-y-4">
                  <p className="font-serif text-2xl uppercase tracking-widest text-primary">
                    Your cart is empty
                  </p>
                  <p className="text-sm text-foreground/40 max-w-xs mx-auto">
                    Add items to your cart to keep track of them and acquire
                    them later.
                  </p>
                </div>
                <Link
                  href="/accessories"
                  className="px-12 py-5 bg-primary text-primary-foreground uppercase tracking-widest text-[11px] font-bold hover:bg-black hover:text-white transition-all hover:scale-[1.02] shadow-xl shadow-primary/10"
                >
                  Browse Products
                </Link>
              </div>
            )}
          </div>

          {/* Summary - Only show if cart has items */}
          {items.length > 0 && (
            <div className="lg:col-span-4 lg:sticky lg:top-40 h-fit bg-secondary/30 p-10 space-y-10 border border-foreground/5 shadow-2xl shadow-black/5 animate-in fade-in slide-in-from-right-4 duration-700">
              <div className="flex justify-between items-baseline pb-6 border-b border-foreground/10">
                <h3 className="text-sm font-bold uppercase tracking-[0.4em] text-primary">
                  Order Summary
                </h3>
                <button
                  onClick={() => setShowClearModal(true)}
                  className="text-[9px] uppercase tracking-widest font-bold opacity-60 hover:opacity-100 transition-all border-b border-primary/40 hover:border-primary pb-0.5 hover:text-primary"
                >
                  Clear Cart
                </button>
              </div>

              <div className="space-y-6">
                <div className="flex justify-between text-[14px] uppercase tracking-widest font-extrabold opacity-80">
                  <span>Subtotal</span>
                  <span className="text-[#d09e3c]">
                    £
                    {subtotal.toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>

                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <span>Delivery</span>
                  <span className="italic">Calculated at next step</span>
                </div>
              </div>

              <div className="pt-10 border-t border-foreground/10">
                <div className="flex justify-between items-baseline mb-10">
                  <span className="uppercase tracking-widest text-[10px] font-bold opacity-80">
                    Total (Est.)
                  </span>
                  <span className="text-3xl font-bold tracking-tight text-primary">
                    £
                    {subtotal.toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <Link
                  href={session ? "/checkout" : "/login"}
                  onClick={() => {
                    if (!session) {
                      toast.error("Please login to proceed to checkout");
                    }
                  }}
                  className="w-full bg-primary text-primary-foreground py-5 uppercase tracking-widest text-[10px] font-bold hover:bg-black hover:text-white transition-all flex items-center justify-center shadow-xl shadow-primary/10"
                >
                  {session ? "Proceed to Checkout" : "Login to Checkout"}
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Delete Item Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setItemToDelete(null)}
          />
          <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => setItemToDelete(null)}
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-8 md:p-12 text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertCircle className="w-8 h-8 text-red-600 opacity-90" />
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-2xl font-serif tracking-widest uppercase text-primary">
                  Remove Item
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Are you sure you want to remove{" "}
                  <span className="font-bold text-[#333]">
                    "{itemToDelete.name}"
                  </span>{" "}
                  from your cart?
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => {
                    removeItem(itemToDelete.id);
                    toast.error(`${itemToDelete.name} removed from cart`);
                    setItemToDelete(null);
                  }}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg flex items-center justify-center gap-3"
                >
                  Confirm Removal
                </button>
                <button
                  onClick={() => setItemToDelete(null)}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
                >
                  Keep Item
                </button>
              </div>
            </div>
            <div className="h-1.5 w-full bg-linear-to-r from-red-600/20 via-red-600/10 to-transparent" />
          </div>
        </div>
      )}

      {/* Clear Cart Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowClearModal(false)}
          />
          <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => setShowClearModal(false)}
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-8 md:p-12 text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertCircle className="w-8 h-8 text-red-600 opacity-90" />
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-2xl font-serif tracking-widest uppercase text-primary">
                  Clear Cart
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Are you sure you want to remove all items from your cart? This
                  action cannot be undone.
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => {
                    items.forEach((item) => removeItem(item.id));
                    toast.error("Cart cleared");
                    setShowClearModal(false);
                  }}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg flex items-center justify-center gap-3"
                >
                  Clear Cart
                </button>
                <button
                  onClick={() => setShowClearModal(false)}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
                >
                  Keep Cart
                </button>
              </div>
            </div>
            <div className="h-1.5 w-full bg-linear-to-r from-red-600/20 via-red-600/10 to-transparent" />
          </div>
        </div>
      )}

      <Footer />
    </main>
  );
}

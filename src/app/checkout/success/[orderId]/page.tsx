"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Check, Package, MapPin, CreditCard, ChevronRight } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { useCartStore } from "@/store/useCartStore";

export default function SuccessPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const clearCart = useCartStore((state) => state.clearCart);

  useEffect(() => {
    clearCart();
  }, [clearCart]);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}`);
        const data = await response.json();
        if (response.ok) {
          setOrder(data.order);
        }
      } catch (error) {
        console.error("Order Fetch Error:", error);
      } finally {
        setLoading(false);
      }
    };

    if (orderId) fetchOrder();
  }, [orderId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="flex flex-col items-center justify-center space-y-8 px-6 text-center pt-32 pb-24">
          <h1 className="text-4xl font-serif uppercase tracking-widest text-primary">
            Order Not Found
          </h1>
          <p className="text-sm text-foreground/80 max-w-md uppercase tracking-widest leading-relaxed font-bold">
            The requested acquisition details could not be retrieved at this
            moment.
          </p>
          <Link
            href="/"
            className="px-12 py-5 bg-primary text-primary-foreground uppercase tracking-widest text-[11px] font-bold hover:bg-black hover:text-white transition-all shadow-xl shadow-primary/10"
          >
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen mt-24 bg-white">
      <Navbar />
      <div className="pt-32 pb-24 border-t border-foreground/5 animate-in fade-in duration-1000">
        <div className="max-w-4xl mx-auto px-6 lg:px-20 space-y-16">
          <div className="space-y-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-full shadow-2xl shadow-primary/20 mb-4 animate-bounce">
              <Check className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl md:text-3xl font-serif uppercase tracking-[0.2em] text-primary">
              Acquisition Confirmed
            </h1>
            <p className="text-xs uppercase tracking-[0.4em] text-primary/90 font-bold">
              Confirmation #{order.orderNumber}
            </p>
            <div className="h-px w-24 bg-primary/20 mx-auto mt-8" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-10">
              <div className="space-y-4">
                <h2 className="text-xs uppercase tracking-widest font-bold text-primary flex items-center gap-3">
                  <Package className="w-4 h-4" />
                  Items Acquired
                </h2>
                <div className="space-y-6 border-l border-primary/10 pl-8 py-4">
                  {order.items.map((item: any) => (
                    <div key={item._id} className="flex gap-6 items-center">
                      <div className="relative w-16 h-20 bg-secondary/20 overflow-hidden shrink-0">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-cover grayscale"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-bold uppercase tracking-widest leading-relaxed text-foreground">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-primary/90 font-bold italic uppercase tracking-widest">
                          QTY: {item.quantity} · £{item.price.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-8 border-t border-foreground/5">
                <div className="flex justify-between items-baseline">
                  <p className="text-[10px] uppercase font-bold tracking-widest opacity-80">
                    Total Valuation
                  </p>
                  <p className="text-2xl font-serif text-[#333]">
                    £{order.totalAmount.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-10">
              <div className="space-y-4">
                <h2 className="text-xs uppercase tracking-widest font-bold text-primary flex items-center gap-3">
                  <MapPin className="w-4 h-4" />
                  Destination Details
                </h2>
                <div className="space-y-1 text-sm bg-white p-8 border border-primary/10 shadow-lg shadow-primary/5">
                  <p className="font-bold text-foreground uppercase tracking-widest text-[11px]">
                    {order.shippingAddress.firstName}{" "}
                    {order.shippingAddress.lastName}
                  </p>
                  <div className="text-xs text-primary/90 font-sans space-y-1 mt-2 font-medium">
                    <p>{order.shippingAddress.address}</p>
                    {order.shippingAddress.address2 && (
                      <p>{order.shippingAddress.address2}</p>
                    )}
                    <p>
                      {order.shippingAddress.city},{" "}
                      {order.shippingAddress.postcode}
                    </p>
                    <p>{order.shippingAddress.country}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-xs uppercase tracking-widest font-bold text-primary flex items-center gap-3">
                  <CreditCard className="w-4 h-4" />
                  Transaction Overview
                </h2>
                <div className="space-y-4 p-8 bg-white border border-primary/10 shadow-lg shadow-primary/5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-primary/90">
                      Method
                    </p>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-foreground">
                      {order.paymentMethod}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-primary/90">
                      Status
                    </p>
                    <p
                      className={`text-[11px] font-bold uppercase tracking-widest ${order.paymentStatus === "Paid" ? "text-primary" : "text-amber-600"}`}
                    >
                      {order.paymentStatus === "Paid"
                        ? "Confirmed & Paid"
                        : order.paymentMethod === "Cash on Delivery"
                          ? "Awaiting Payment (COD)"
                          : "Pending Verification"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-16 border-t border-primary/10 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="space-y-2 text-center md:text-left">
              <p className="text-sm font-bold uppercase tracking-widest text-primary">
                Service Team
              </p>
              <p className="text-[10px] text-primary/90 uppercase tracking-[0.3em] font-bold">
                We will notify you via email when dispatch begins.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-4 px-12 py-5 bg-primary text-primary-foreground uppercase tracking-widest text-[11px] font-bold hover:bg-black hover:text-white transition-all group shadow-xl shadow-primary/20"
            >
              Continue Shopping
              <ChevronRight className="w-4 h-4 group-hover:translate-x-2 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

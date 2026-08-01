"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { cn } from "@/lib/utils";
import { getProductsDisplayImages } from "@/app/actions/products";
import { isShopifyCheckoutUiEnabled } from "@/lib/shopify-checkout-public";

export function CartDrawer() {
  const { isOpen, close } = useCartDrawerStore();
  const {
    items,
    updateQuantity,
    removeItem,
    clearCart,
    getTotalPrice,
    getTotalItems,
    syncItemImages,
  } = useCartStore();
  const [mounted, setMounted] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const shopifyCheckout = isShopifyCheckoutUiEnabled();

  const hasConfiguredItems = items.some((i) => i.isConfigured);

  const startShopifyCheckout = async () => {
    if (checkingOut || items.length === 0) return;
    if (hasConfiguredItems) {
      toast.message("Made-to-measure items use site checkout", {
        description: "Continue via Checkout to place your configured order.",
      });
      close();
      window.location.assign("/checkout");
      return;
    }
    setCheckingOut(true);
    try {
      const res = await fetch("/api/checkout/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({
            id: i.id,
            quantity: i.quantity,
            shopifyVariantId: i.shopifyVariantId,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.error || "Failed to start Shopify Checkout");
      }
      clearCart();
      close();
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to start Shopify Checkout",
      );
      setCheckingOut(false);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep cart thumbnails in sync with the product-page primary image
  useEffect(() => {
    if (!isOpen || items.length === 0) return;
    const catalogIds = items
      .filter((i) => !i.isConfigured && !String(i.id).startsWith("cfg:"))
      .map((i) => i.id);
    if (catalogIds.length === 0) return;
    let cancelled = false;

    getProductsDisplayImages(catalogIds).then((result) => {
      if (cancelled || !result.success) return;
      syncItemImages(result.images);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, items.map((i) => i.id).join("|"), syncItemImages]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!mounted) return null;

  const subtotal = getTotalPrice();
  const count = getTotalItems();

  return (
    <div
      className={cn(
        "fixed inset-0 z-[120] pointer-events-none",
        isOpen && "pointer-events-auto",
      )}
      aria-hidden={!isOpen}
    >
      <button
        type="button"
        aria-label="Close cart"
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0",
        )}
        onClick={close}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        className={cn(
          "absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-foreground/8 shrink-0">
          <div className="flex items-center gap-3">
            <ShoppingBag className="w-5 h-5 stroke-[1.5]" />
            <div>
              <h2 className="text-[11px] uppercase tracking-[0.22em] font-bold">
                Your cart
              </h2>
              <p className="text-[10px] text-muted-foreground tracking-wide">
                {count === 0
                  ? "No items yet"
                  : `${count} item${count === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="p-2 hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-8 py-16 space-y-5">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <ShoppingBag className="w-7 h-7 text-primary opacity-80" />
              </div>
              <div className="space-y-2">
                <p className="font-serif text-xl uppercase tracking-[0.08em]">
                  Cart is empty
                </p>
                <p className="text-sm text-muted-foreground max-w-[220px]">
                  Browse the catalog and add materials to get started.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="px-8 py-3 bg-primary text-primary-foreground text-[10px] uppercase tracking-[0.22em] font-bold hover:bg-black hover:text-white transition-colors"
              >
                Continue shopping
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-foreground/8">
              {items.map((item) => {
                const href = item.isConfigured
                  ? item.id.startsWith("cfg:")
                    ? "/configurator"
                    : `/configurator/item/${item.id}`
                  : `/products/${item.id}`;

                return (
                <li key={item.id} className="flex gap-4 p-5">
                  <Link
                    href={href}
                    onClick={close}
                    className="relative w-20 h-24 bg-secondary shrink-0 overflow-hidden flex items-center justify-center"
                  >
                    {item.image?.trim() ? (
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <Package className="w-6 h-6 text-foreground/20" />
                    )}
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={href}
                          onClick={close}
                          className="text-[11px] uppercase tracking-wide font-bold line-clamp-2 hover:text-primary transition-colors"
                        >
                          {item.name}
                        </Link>
                        <button
                          type="button"
                          onClick={() =>
                            setItemToDelete({ id: item.id, name: item.name })
                          }
                          className="p-1 text-foreground/40 hover:text-red-600 transition-colors shrink-0"
                          aria-label={`Remove ${item.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {item.isConfigured ? "Configured" : item.category}
                      </p>
                      {item.configurationSummary ? (
                        <p className="text-[10px] text-muted-foreground leading-snug line-clamp-3">
                          {item.configurationSummary}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-3 mt-3">
                      <div className="flex items-center border border-foreground/10">
                        <button
                          type="button"
                          onClick={() => {
                            const result = updateQuantity(
                              item.id,
                              item.quantity - 1,
                            );
                            if (!result.ok) toast.error(result.error);
                          }}
                          className="p-2 hover:bg-secondary transition-colors"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-[11px] font-bold w-7 text-center">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const result = updateQuantity(
                              item.id,
                              item.quantity + 1,
                            );
                            if (!result.ok) toast.error(result.error);
                          }}
                          disabled={
                            !item.isConfigured &&
                            typeof item.stock === "number" &&
                            item.quantity >= item.stock
                          }
                          className="p-2 hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-sm font-semibold text-primary tabular-nums">
                        £
                        {(item.price * item.quantity).toLocaleString("en-GB", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>
                </li>
              );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="shrink-0 border-t border-foreground/8 bg-white p-5 space-y-4">
            <div className="flex justify-between text-[11px] uppercase tracking-[0.18em] font-bold">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-primary tabular-nums">
                £
                {subtotal.toLocaleString("en-GB", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground tracking-wide">
              {hasConfiguredItems
                ? "Made-to-measure items checkout on this site (sizes & options recorded on the order)"
                : shopifyCheckout
                  ? "Secure payment on Shopify Checkout"
                  : "Delivery calculated at checkout"}
            </p>
            {shopifyCheckout && !hasConfiguredItems ? (
              <button
                type="button"
                onClick={startShopifyCheckout}
                disabled={checkingOut}
                className="flex items-center justify-center w-full py-4 bg-primary text-primary-foreground text-[10px] uppercase tracking-[0.22em] font-bold hover:bg-black hover:text-white transition-colors disabled:opacity-60 disabled:cursor-wait"
              >
                {checkingOut ? "Redirecting…" : "Checkout"}
              </button>
            ) : (
              <Link
                href="/checkout"
                onClick={close}
                className="flex items-center justify-center w-full py-4 bg-primary text-primary-foreground text-[10px] uppercase tracking-[0.22em] font-bold hover:bg-black hover:text-white transition-colors"
              >
                Checkout
              </Link>
            )}
            {shopifyCheckout && !hasConfiguredItems && (
              <Link
                href="/checkout"
                onClick={close}
                className="flex items-center justify-center w-full py-2 text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-foreground transition-colors"
              >
                Cash on delivery instead
              </Link>
            )}
            <button
              type="button"
              onClick={close}
              className="w-full text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Continue shopping
            </button>
          </div>
        )}
      </aside>

      {itemToDelete && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Dismiss"
            onClick={() => setItemToDelete(null)}
          />
          <div className="relative bg-white w-full max-w-sm p-8 text-center space-y-6 shadow-2xl">
            <div className="flex justify-center">
              <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-serif text-xl uppercase tracking-[0.08em]">
                Remove item
              </h3>
              <p className="text-sm text-muted-foreground">
                Remove{" "}
                <span className="font-semibold text-foreground">
                  {itemToDelete.name}
                </span>{" "}
                from your cart?
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  removeItem(itemToDelete.id);
                  toast.error(`${itemToDelete.name} removed from cart`);
                  setItemToDelete(null);
                }}
                className="w-full py-3 bg-red-600 text-white text-[10px] uppercase tracking-[0.22em] font-bold hover:bg-red-700 transition-colors"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="w-full py-2 text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-foreground"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

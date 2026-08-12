"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  Heart,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useWishlistDrawerStore } from "@/store/useWishlistDrawerStore";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { useModalStore } from "@/store/useModalStore";
import {
  getWishlist,
  removeFromWishlist as removeFromDb,
  clearWishlist as clearDb,
} from "@/actions/wishlist";
import { getProductsDisplayImages } from "@/app/actions/products";
import { WishlistRecommendations } from "@/components/wishlist/WishlistRecommendations";
import { cn } from "@/lib/utils";

export function WishlistDrawer() {
  const { isOpen, close } = useWishlistDrawerStore();
  const { items, removeItem, clearWishlist, setItems, syncItemImages } =
    useWishlistStore();
  const addToCart = useCartStore((s) => s.addItem);
  const openCart = useCartDrawerStore((s) => s.open);
  const { data: session, status } = useSession();
  const onAuthOpen = useModalStore((s) => s.onOpen);
  const [mounted, setMounted] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || status === "loading") return;
    if (!session) return;

    let cancelled = false;
    getWishlist().then((result) => {
      if (cancelled || !result.success || !result.items) return;
      setItems(result.items);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, session, status, setItems]);

  useEffect(() => {
    if (!isOpen || items.length === 0) return;
    let cancelled = false;

    getProductsDisplayImages(items.map((i) => i.id)).then((result) => {
      if (cancelled || !result.success) return;
      syncItemImages(result.images);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, items, syncItemImages]);

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

  const handleRemove = async (id: string, name: string) => {
    removeItem(id);
    if (session) await removeFromDb(id);
    toast.info(`${name} removed from your wishlist`);
    setItemToDelete(null);
  };

  const handleClearAll = async () => {
    clearWishlist();
    if (session) await clearDb();
    toast.info("Wishlist cleared");
    setShowClearModal(false);
  };

  const handleMoveToCart = (item: (typeof items)[0]) => {
    if (!session) {
      onAuthOpen();
      return;
    }

    const result = addToCart(item);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    removeItem(item.id);
    if (session) removeFromDb(item.id);
    toast.success(`${item.name} moved to your cart`);
    close();
    openCart();
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-120 pointer-events-none",
        isOpen && "pointer-events-auto",
      )}
      aria-hidden={!isOpen}
    >
      <button
        type="button"
        aria-label="Close wishlist"
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0",
        )}
        onClick={close}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Wishlist"
        className={cn(
          "absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-foreground/8 shrink-0">
          <div className="flex items-center gap-3">
            <Heart className="w-5 h-5 stroke-[1.5]" />
            <div>
              <h2 className="text-[11px] uppercase tracking-[0.22em] font-bold">
                Wishlist
              </h2>
              <p className="text-[10px] text-muted-foreground tracking-wide">
                {items.length === 0
                  ? "No saved items"
                  : `${items.length} item${items.length === 1 ? "" : "s"}`}
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
                <Heart className="w-7 h-7 text-primary opacity-80" />
              </div>
              <div className="space-y-2">
                <p className="font-serif text-xl uppercase tracking-[0.08em]">
                  Wishlist is empty
                </p>
                <p className="text-sm text-muted-foreground max-w-55">
                  Save pieces you love and move them to your cart anytime.
                </p>
              </div>
              <Link
                href="/category"
                onClick={close}
                className="px-8 py-3 bg-primary text-primary-foreground text-[10px] uppercase tracking-[0.22em] font-bold hover:bg-black hover:text-white transition-colors"
              >
                Continue shopping
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-foreground/8">
              {items.map((item) => (
                <li key={item.id} className="flex gap-4 p-5">
                  <Link
                    href={`/products/${item.id}`}
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
                      <Heart className="w-6 h-6 text-foreground/20" />
                    )}
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/products/${item.id}`}
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
                        {item.category}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-3 mt-3">
                      <p className="text-sm font-semibold text-primary tabular-nums">
                        £
                        {item.price.toLocaleString("en-GB", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleMoveToCart(item)}
                        className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] font-bold text-foreground/70 hover:text-primary transition-colors"
                      >
                        <ShoppingBag className="w-3 h-3" />
                        Add to cart
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 && <WishlistRecommendations />}
        </div>

        {items.length > 0 && (
          <div className="shrink-0 border-t border-foreground/8 bg-white p-5 space-y-3">
            <button
              type="button"
              onClick={() => setShowClearModal(true)}
              className="w-full text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-red-600 transition-colors py-2"
            >
              Clear wishlist
            </button>
            <Link
              href="/category"
              onClick={close}
              className="flex items-center justify-center w-full py-4 bg-primary text-primary-foreground text-[10px] uppercase tracking-[0.22em] font-bold hover:bg-black hover:text-white transition-colors"
            >
              Continue shopping
            </Link>
          </div>
        )}
      </aside>

      {itemToDelete && (
        <div className="fixed inset-0 z-130 flex items-center justify-center p-4">
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
                from your wishlist?
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() =>
                  handleRemove(itemToDelete.id, itemToDelete.name)
                }
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

      {showClearModal && (
        <div className="fixed inset-0 z-130 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Dismiss"
            onClick={() => setShowClearModal(false)}
          />
          <div className="relative bg-white w-full max-w-sm p-8 text-center space-y-6 shadow-2xl">
            <div className="flex justify-center">
              <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-serif text-xl uppercase tracking-[0.08em]">
                Clear wishlist
              </h3>
              <p className="text-sm text-muted-foreground">
                Remove all saved items? This cannot be undone.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleClearAll}
                className="w-full py-3 bg-red-600 text-white text-[10px] uppercase tracking-[0.22em] font-bold hover:bg-red-700 transition-colors"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                className="w-full py-2 text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-foreground"
              >
                Keep items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

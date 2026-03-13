"use client";

import { useWishlistStore } from "@/store/useWishlistStore";
import { useCartStore } from "@/store/useCartStore";
import {
  ShoppingBag,
  Trash2,
  Heart,
  ChevronRight,
  X,
  AlertCircle,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  getWishlist,
  removeFromWishlist as removeFromDb,
  clearWishlist as clearDb,
} from "@/actions/wishlist";
import { useSession } from "next-auth/react";
import { WishlistSkeleton } from "@/components/profile/ProfileSkeletons";

export default function WishlistPage() {
  const { items, removeItem, clearWishlist, setItems } = useWishlistStore();
  const addItem = useCartStore((state) => state.addItem);
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(true);

  // Modal states
  const [itemToDelete, setItemToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);

  useEffect(() => {
    const fetchWishlist = async () => {
      if (status === "loading") return;

      if (session) {
        setLoading(true);
        try {
          const result = await getWishlist();
          if (result.success && result.items) {
            setItems(result.items);
          }
        } catch (error) {
          console.error("Failed to fetch wishlist:", error);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    };
    fetchWishlist();
  }, [session, status, setItems]);

  const handleRemove = async (id: string, name: string) => {
    removeItem(id);
    if (session) {
      await removeFromDb(id);
    }
    toast.info(`${name} removed from your wishlist`);
  };

  const handleClearAll = async () => {
    clearWishlist();
    if (session) {
      await clearDb();
    }
    toast.info("Wishlist cleared");
  };

  const handleMoveToCart = async (item: any) => {
    addItem(item);
    removeItem(item.id);
    if (session) {
      await removeFromDb(item.id);
    }
    toast.success(`${item.name} moved to your cart`);
  };

  return (
    <main className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <PageHeader
        title="Wishlist"
        description="A curated list of your desired architectural pieces and luxury selections."
        breadcrumb={[{ label: "Wishlist", href: "/wishlist" }]}
      />

      <section className="flex-1 pb-24 px-6 lg:px-20 max-w-7xl mx-auto w-full">
        {items.length > 0 && (
          <div className="flex justify-end mb-10 pt-10">
            <button
              onClick={() => setShowClearModal(true)}
              className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-60 hover:opacity-100 transition-all border-b border-primary/40 hover:border-primary pb-1 hover:text-primary"
            >
              Clear Entire Wishlist
            </button>
          </div>
        )}

        {loading ? (
          <WishlistSkeleton />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center space-y-8 animate-in fade-in duration-700">
            <div className="w-24 h-24 bg-primary/10 flex items-center justify-center rounded-full">
              <Heart className="w-10 h-10 text-primary opacity-90" />
            </div>
            <div className="space-y-4">
              <p className="font-serif text-2xl uppercase tracking-widest text-primary">
                Your wishlist is empty
              </p>
              <p className="text-sm text-foreground/40 max-w-xs mx-auto">
                Save items you love to keep track of them and acquire them
                later.
              </p>
            </div>
            <Link
              href="/"
              className="px-12 py-5 bg-primary text-primary-foreground uppercase tracking-widest text-[11px] font-bold hover:bg-black hover:text-white transition-all hover:scale-[1.02] shadow-xl shadow-primary/10"
            >
              Discover Products
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {items.map((item) => (
              <div
                key={item.id}
                className="group relative bg-white border border-foreground/5 overflow-hidden transition-all duration-500 hover:shadow-2xl hover:shadow-black/5"
              >
                <div className="relative aspect-4/5 overflow-hidden bg-secondary">
                  <Image
                    src={item.image}
                    alt={item.name}
                    fill
                    className="object-cover grayscale group-hover:grayscale-0 transition-all duration-1000 group-hover:scale-105"
                  />
                  <button
                    onClick={() =>
                      setItemToDelete({ id: item.id, name: item.name })
                    }
                    className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-3 opacity-0 group-hover:opacity-800 transition-all duration-300 transform -translate-y-2 group-hover:translate-y-0 z-30 hover:bg-red-50 hover:text-red-500 border border-foreground/5"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-8 space-y-6 text-center">
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary">
                      {item.category}
                    </p>
                    <h3 className="text-xl font-serif tracking-widest uppercase text-[#333] truncate">
                      {item.name}
                    </h3>
                    <p className="text-lg font-bold tracking-tight text-primary">
                      £
                      {item.price.toLocaleString("en-GB", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>

                  <button
                    onClick={() => handleMoveToCart(item)}
                    className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-primary text-primary-foreground uppercase tracking-widest text-[11px] font-bold hover:bg-black hover:text-white transition-all group/btn"
                  >
                    <ShoppingBag className="w-4 h-4 group-hover/btn:-translate-y-0.5 transition-transform" />
                    Add to Cart
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
                  from your wishlist?
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => {
                    handleRemove(itemToDelete.id, itemToDelete.name);
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

      {/* Clear Wishlist Modal */}
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
                  Clear Wishlist
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Are you sure you want to empty your entire wishlist? This
                  action cannot be undone.
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => {
                    handleClearAll();
                    setShowClearModal(false);
                  }}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg flex items-center justify-center gap-3"
                >
                  Clear Wishlist
                </button>
                <button
                  onClick={() => setShowClearModal(false)}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
                >
                  Keep Wishlist
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

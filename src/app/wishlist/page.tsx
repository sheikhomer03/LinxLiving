"use client";

import { useWishlistStore } from "@/store/useWishlistStore";
import { useCartStore } from "@/store/useCartStore";
import { ShoppingBag, Trash2, Heart, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
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
    toast.success(`${item.name} moved to your collection`);
  };

  return (
    <main className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <section className="flex-1 pt-40 md:pt-52 pb-24 px-6 lg:px-20 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-baseline mb-16 gap-4">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-serif tracking-tight uppercase text-[#333]">
              Wishlist
            </h1>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">
              <Link href="/" className="hover:opacity-100">
                Home
              </Link>
              <ChevronRight className="w-3 h-3" />
              <span>Wishlist</span>
            </div>
          </div>
          {items.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 hover:opacity-100 transition-opacity border-b border-foreground/20 pb-1"
            >
              Clear Entire Wishlist
            </button>
          )}
        </div>

        {loading ? (
          <WishlistSkeleton />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center space-y-8 animate-in fade-in duration-700">
            <div className="w-24 h-24 bg-secondary flex items-center justify-center rounded-full">
              <Heart className="w-10 h-10 opacity-20" />
            </div>
            <div className="space-y-4">
              <p className="font-serif text-2xl uppercase tracking-widest text-[#333]">
                Your wishlist is empty
              </p>
              <p className="text-sm text-foreground/50 max-w-xs mx-auto">
                Save items you love to keep track of them and acquire them
                later.
              </p>
            </div>
            <Link
              href="/"
              className="px-12 py-5 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-black/5"
            >
              Discover Collections
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
                    onClick={() => handleRemove(item.id, item.name)}
                    className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform -translate-y-2 group-hover:translate-y-0 z-30 hover:bg-red-50 hover:text-red-500 border border-foreground/5"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-8 space-y-6 text-center">
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">
                      {item.category}
                    </p>
                    <h3 className="text-xl font-serif tracking-widest uppercase text-[#333] truncate">
                      {item.name}
                    </h3>
                    <p className="text-lg font-bold tracking-tight text-[#333]">
                      £
                      {item.price.toLocaleString("en-GB", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>

                  <button
                    onClick={() => handleMoveToCart(item)}
                    className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-all group/btn"
                  >
                    <ShoppingBag className="w-4 h-4 group-hover/btn:-translate-y-0.5 transition-transform" />
                    Move to Collection
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}

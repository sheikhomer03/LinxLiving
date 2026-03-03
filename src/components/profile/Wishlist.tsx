"use client";
import Image from "next/image";
import Link from "next/link";
import { Trash2, Heart } from "lucide-react";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useSession } from "next-auth/react";
import {
  getWishlist,
  removeFromWishlist as removeFromDb,
} from "@/actions/wishlist";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { WishlistSkeleton } from "./ProfileSkeletons";

export function Wishlist() {
  const { items, removeItem, setItems } = useWishlistStore();
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
      }
    };
    fetchWishlist();
  }, [session, setItems]);

  if (loading) {
    return <WishlistSkeleton />;
  }

  const handleRemove = async (id: string, name: string) => {
    removeItem(id);
    if (session) {
      await removeFromDb(id);
    }
    toast.info(`${name} removed from your wishlist`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="space-y-2">
        <h3 className="text-xl font-serif tracking-widest uppercase">
          My Wishlist
        </h3>
        <p className="text-sm text-muted-foreground font-sans">
          {items.length > 0
            ? "Items you've saved for later inspiration."
            : "Your wishlist is currently empty."}
        </p>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 py-8 border-t border-foreground/5">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex gap-4 p-4 border border-foreground/5 group hover:bg-secondary/20 transition-colors bg-white relative"
            >
              <div className="relative w-24 h-24 bg-secondary overflow-hidden">
                <Image
                  src={item.image}
                  alt={item.name}
                  fill
                  className="object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                />
              </div>
              <div className="flex-1 flex flex-col justify-between py-1">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-widest font-bold line-clamp-2">
                    {item.name}
                  </p>
                  <p className="text-sm font-serif">
                    £
                    {item.price.toLocaleString("en-GB", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
                <div className="flex justify-between items-center border-t border-foreground/5 pt-2">
                  <Link
                    href={`/products/${item.id}`}
                    className="text-[9px] uppercase tracking-widest font-bold hover:underline"
                  >
                    View Product
                  </Link>
                  <button
                    onClick={() => handleRemove(item.id, item.name)}
                    className="text-destructive hover:opacity-50 transition-opacity p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <div className="py-20 text-center border-t border-foreground/5">
          <Heart className="w-12 h-12 mx-auto mb-4 opacity-10" />
          <Link
            href="/collections"
            className="text-[11px] uppercase tracking-widest font-bold border-b border-foreground/20 hover:border-foreground transition-all pb-1"
          >
            Explore our collections
          </Link>
        </div>
      )}
    </div>
  );
}

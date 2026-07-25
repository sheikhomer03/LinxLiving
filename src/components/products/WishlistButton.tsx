"use client";

import React, { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useSession } from "next-auth/react";
import { useModalStore } from "@/store/useModalStore";
import {
  addToWishlist as addToDb,
  removeFromWishlist as removeFromDb,
} from "@/actions/wishlist";
import { useWishlistDrawerStore } from "@/store/useWishlistDrawerStore";

interface WishlistButtonProps {
  product: {
    id: string;
    name: string;
    price: number;
    image: string;
    category: string;
  };
  variant?: "icon" | "full";
}

export function WishlistButton({
  product,
  variant = "full",
}: WishlistButtonProps) {
  const { data: session } = useSession();
  const onOpen = useModalStore((state) => state.onOpen);
  const openWishlist = useWishlistDrawerStore((state) => state.open);
  const {
    addItem: addToWishlist,
    removeItem: removeFromWishlist,
    isInWishlist,
  } = useWishlistStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid SSR/client mismatch — wishlist is hydrated from localStorage
  const isWishlisted = mounted && isInWishlist(product.id);

  const toggleWishlist = async () => {
    if (!session) {
      onOpen();
      return;
    }

    if (isInWishlist(product.id)) {
      removeFromWishlist(product.id);
      await removeFromDb(product.id);
      toast.info(`${product.name} removed from your wishlist`);
    } else {
      addToWishlist(product);
      await addToDb(product.id);
      toast.success(`${product.name} added to your wishlist`);
      openWishlist();
    }
  };

  if (variant === "icon") {
    return (
      <button
        onClick={toggleWishlist}
        className="p-3 border border-foreground/10 hover:bg-secondary transition-colors"
        title={isWishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
      >
        <Heart
          className={`w-4 h-4 ${isWishlisted ? "fill-red-500 stroke-red-500" : ""}`}
        />
      </button>
    );
  }

  return (
    <button
      onClick={toggleWishlist}
      className="w-full border border-[#333]/20 py-5 uppercase tracking-widest text-[10px] font-bold hover:bg-[#333] hover:text-white transition-all flex items-center justify-center gap-3"
    >
      <Heart
        className={`w-4 h-4 ${isWishlisted ? "fill-red-500 stroke-red-500" : ""}`}
      />
      {isWishlisted ? "In Wishlist" : "Add to Wishlist"}
    </button>
  );
}

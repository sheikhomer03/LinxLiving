"use client";

import { useCartStore } from "@/store/useCartStore";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useModalStore } from "@/store/useModalStore";

interface AddToCartButtonProps {
  product: {
    id: string;
    name: string;
    price: number;
    image: string;
    category: string;
  };
}

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const { data: session } = useSession();
  const onOpen = useModalStore((state) => state.onOpen);
  const addItem = useCartStore((state) => state.addItem);

  const handleAddToCart = () => {
    if (!session) {
      onOpen();
      return;
    }

    addItem(product);
    toast.success(`${product.name} added to your cart`);
  };

  return (
    <button
      onClick={handleAddToCart}
      className="w-full bg-[#1a1a1a] text-primary py-5 text-center uppercase tracking-widest text-[11px] font-black hover:bg-black transition-all shadow-xl border border-primary/20 hover:border-primary/40 relative overflow-hidden group"
    >
      <span className="relative z-10">Add to Cart</span>
      <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
    </button>
  );
}

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
    toast.success(`${product.name} added to your collection`);
  };

  return (
    <button
      onClick={handleAddToCart}
      className="w-full bg-[#333] text-white py-5 text-center uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-colors shadow-lg shadow-black/5"
    >
      Add to Collection
    </button>
  );
}

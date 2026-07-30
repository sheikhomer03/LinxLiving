"use client";

import { useRouter } from "next/navigation";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { toast } from "sonner";
import { CONTACT_HREF, isPriceOnRequest } from "@/lib/priceOnRequest";

interface AddToCartButtonProps {
  product: {
    id: string;
    name: string;
    price: number;
    image: string;
    category: string;
    stock?: number;
    shopifyVariantId?: string | null;
  };
}

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const cartQty = useCartStore((state) => state.getCartQuantity(product.id));
  const openCart = useCartDrawerStore((state) => state.open);
  const catalogStock = product.stock ?? 0;
  const available = Math.max(0, catalogStock - cartQty);
  const priceOnRequest = isPriceOnRequest(product.price);

  const handleAddToCart = () => {
    if (priceOnRequest) {
      router.push(CONTACT_HREF);
      return;
    }

    if (available <= 0) {
      toast.error(
        catalogStock <= 0
          ? "This product is out of stock"
          : "No more stock available to add",
      );
      return;
    }

    const result = addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      category: product.category,
      stock: catalogStock,
      shopifyVariantId: product.shopifyVariantId,
    });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${product.name} added to your cart`);
    openCart();
  };

  const disabled = !priceOnRequest && available <= 0;

  return (
    <button
      onClick={handleAddToCart}
      disabled={disabled}
      className="w-full bg-[#1a1a1a] text-primary py-5 text-center uppercase tracking-widest text-[11px] font-black hover:bg-black transition-all shadow-xl border border-primary/20 hover:border-primary/40 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#1a1a1a]"
    >
      <span className="relative z-10">
        {disabled ? "Out of Stock" : "Add to Cart"}
      </span>
      <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
    </button>
  );
}

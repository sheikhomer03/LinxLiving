"use client";
import { useCartStore } from "@/store/useCartStore";
import { Plus, Heart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useSession } from "next-auth/react";
import { useModalStore } from "@/store/useModalStore";
import {
  addToWishlist as addToDb,
  removeFromWishlist as removeFromDb,
} from "@/actions/wishlist";

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
}

export function ProductCard({
  id,
  name,
  price,
  image,
  category = "Product",
}: ProductCardProps) {
  const { data: session } = useSession();
  const onOpen = useModalStore((state) => state.onOpen);
  const addItem = useCartStore((state) => state.addItem);
  const {
    addItem: addToWishlist,
    removeItem: removeFromWishlist,
    isInWishlist,
  } = useWishlistStore();

  const isWishlisted = isInWishlist(id);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      onOpen();
      return;
    }

    addItem({ id, name, price, image, category });
    toast.success(`${name} added to your collection`);
  };

  const toggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      onOpen();
      return;
    }

    if (isWishlisted) {
      removeFromWishlist(id);
      if (session) {
        await removeFromDb(id);
      }
      toast.info(`${name} removed from your wishlist`);
    } else {
      addToWishlist({ id, name, price, image, category });
      if (session) {
        await addToDb(id);
      }
      toast.success(`${name} added to your wishlist`);
    }
  };

  return (
    <div className="group bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] transition-shadow duration-500 overflow-hidden">
      <Link
        href={`/products/${id}`}
        className="block relative aspect-square overflow-hidden bg-secondary"
      >
        <Image
          src={image}
          alt={name}
          fill
          className="object-cover transition-transform duration-1000 group-hover:scale-105"
        />

        <button
          onClick={toggleWishlist}
          className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform -translate-y-2 group-hover:translate-y-0 z-30 hover:bg-foreground hover:text-background border border-foreground/5"
        >
          <Heart
            className={`w-5 h-5 ${isWishlisted ? "fill-red-500 stroke-red-500" : ""}`}
          />
        </button>

        <button
          onClick={handleAddToCart}
          className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm p-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 z-30 hover:bg-foreground hover:text-background border border-foreground/5"
        >
          <Plus className="w-5 h-5" />
        </button>
      </Link>

      <div className="p-6 md:p-8 text-center space-y-4">
        <Link
          href={`/products/${id}`}
          className="block text-[11px] md:text-[13px] uppercase tracking-widest hover:opacity-50 transition-opacity leading-relaxed line-clamp-2 h-10"
          title={name}
        >
          {name}
        </Link>
        <p className="text-[13px] md:text-sm tracking-wide text-foreground/80">
          £{price.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          <span className="text-[9px] uppercase tracking-widest opacity-60 ml-2 font-sans">
            (Inc Vat)
          </span>
        </p>
      </div>
    </div>
  );
}

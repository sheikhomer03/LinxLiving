"use client";
import { useCartStore } from "@/store/useCartStore";
import { Plus, Heart, Loader2 } from "lucide-react";
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
import { useEffect, useState } from "react";

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  image?: string;
  category: string;
}

export function ProductCard({
  id,
  name,
  price,
  image = "",
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
  const imageSrc = image?.trim() || "";
  const hasImage = Boolean(imageSrc);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [imageSrc]);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    addItem({ id, name, price, image: imageSrc, category });
    toast.success(`${name} added to your cart`);
  };

  const toggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isWishlisted) {
      removeFromWishlist(id);
      if (session) {
        await removeFromDb(id);
      }
      toast.info(`${name} removed from your wishlist`);
    } else {
      if (!session) {
        onOpen();
        return;
      }

      addToWishlist({ id, name, price, image: imageSrc, category });
      if (session) {
        await addToDb(id);
      }
      toast.success(`${name} added to your wishlist`);
    }
  };

  const showImage = hasImage && !imageFailed;

  return (
    <div className="group bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] transition-shadow duration-500 overflow-hidden">
      <Link
        href={`/products/${id}`}
        className="block relative aspect-4/3 overflow-hidden bg-secondary"
      >
        {showImage ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-secondary">
                <Loader2 className="w-6 h-6 animate-spin text-foreground/35" />
              </div>
            )}
            <Image
              src={imageSrc}
              alt={name}
              fill
              className={`object-cover transition-all duration-1000 group-hover:scale-105 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                setImageFailed(true);
                setImageLoaded(false);
              }}
            />
          </>
        ) : null}

        <button
          onClick={toggleWishlist}
          className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-3 lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-300 transform-none lg:-translate-y-2 lg:group-hover:translate-y-0 z-30 hover:bg-foreground hover:text-background border border-foreground/5 shadow-sm"
        >
          <Heart
            className={`w-5 h-5 ${isWishlisted ? "fill-red-500 stroke-red-500" : ""}`}
          />
        </button>

        <button
          onClick={handleAddToCart}
          className="absolute bottom-4 right-4 bg-primary text-primary-foreground p-3 lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-300 transform-none lg:translate-y-2 lg:group-hover:translate-y-0 z-30 hover:bg-black hover:text-white border border-primary shadow-lg"
        >
          <Plus className="w-5 h-5" />
        </button>
      </Link>

      <div className="p-6 md:p-8 text-center space-y-4">
        <Link
          href={`/products/${id}`}
          className="block text-[11px] md:text-[13px] uppercase tracking-widest hover:opacity-80 transition-opacity leading-relaxed line-clamp-2 h-10"
          title={name}
        >
          {name}
        </Link>
        <p className="text-[13px] md:text-sm tracking-wide text-primary font-bold">
          £{price.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          <span className="text-[9px] uppercase tracking-widest opacity-90 ml-2 font-sans text-foreground/60">
            (Inc Vat)
          </span>
        </p>
      </div>
    </div>
  );
}

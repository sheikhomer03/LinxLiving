"use client";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { Plus, Heart, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useWishlistDrawerStore } from "@/store/useWishlistDrawerStore";
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
  stock?: number;
}

export function ProductCard({
  id,
  name,
  price,
  image = "",
  category = "Product",
  stock,
}: ProductCardProps) {
  const { data: session } = useSession();
  const onOpen = useModalStore((state) => state.onOpen);
  const addItem = useCartStore((state) => state.addItem);
  const cartQty = useCartStore((state) => state.getCartQuantity(id));
  const openCart = useCartDrawerStore((state) => state.open);
  const openWishlist = useWishlistDrawerStore((state) => state.open);
  const {
    addItem: addToWishlist,
    removeItem: removeFromWishlist,
    isInWishlist,
  } = useWishlistStore();

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isWishlisted = mounted && isInWishlist(id);
  const imageSrc = image?.trim() || "";
  const hasImage = Boolean(imageSrc);
  const available =
    typeof stock === "number" ? Math.max(0, stock - cartQty) : undefined;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [imageSrc]);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (typeof available === "number" && available <= 0) {
      toast.error(
        (stock ?? 0) <= 0
          ? "This product is out of stock"
          : "No more stock available to add",
      );
      return;
    }

    const result = addItem({
      id,
      name,
      price,
      image: imageSrc,
      category,
      stock,
    });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${name} added to your cart`);
    openCart();
  };

  const toggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isInWishlist(id)) {
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
      openWishlist();
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
          disabled={typeof available === "number" && available <= 0}
          className="absolute bottom-4 right-4 bg-primary text-primary-foreground p-3 lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-300 transform-none lg:translate-y-2 lg:group-hover:translate-y-0 z-30 hover:bg-black hover:text-white border border-primary shadow-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:hover:text-primary-foreground"
        >
          <Plus className="w-5 h-5" />
        </button>
      </Link>

      <div className="p-4 md:p-5 text-center space-y-2">
        <Link
          href={`/products/${id}`}
          className="block text-[11px] md:text-xs uppercase tracking-wide hover:opacity-80 transition-opacity leading-snug line-clamp-2 min-h-[2.5rem]"
          title={name}
        >
          {name}
        </Link>
        <p className="text-sm tracking-wide text-foreground font-semibold">
          £{price.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          <span className="text-[9px] uppercase tracking-wider ml-1.5 font-sans font-medium text-muted-foreground">
            (Inc Vat)
          </span>
        </p>
      </div>
    </div>
  );
}

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
  shopifyVariantId?: string | null;
  /** Catalogue view mode */
  layout?: "grid" | "list";
}

export function ProductCard({
  id,
  name,
  price,
  image = "",
  category = "Product",
  stock,
  shopifyVariantId,
  layout = "grid",
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
      shopifyVariantId,
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

  if (layout === "list") {
    return (
      <article className="group grid grid-cols-[112px_1fr] sm:grid-cols-[180px_1fr] md:grid-cols-[220px_1fr] gap-0 bg-white border border-foreground/12 overflow-hidden hover:border-foreground/25 transition-colors">
        <Link
          href={`/products/${id}`}
          className="relative block bg-secondary min-h-[112px] sm:min-h-[180px] md:min-h-[200px] overflow-hidden"
        >
          {showImage ? (
            <>
              {!imageLoaded && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-secondary">
                  <Loader2 className="w-5 h-5 animate-spin text-foreground/35" />
                </div>
              )}
              <Image
                src={imageSrc}
                alt={name}
                fill
                sizes="(max-width: 640px) 112px, (max-width: 768px) 180px, 220px"
                className={`object-cover transition-opacity duration-500 ${
                  imageLoaded ? "opacity-100" : "opacity-0"
                }`}
                onLoad={() => setImageLoaded(true)}
                onError={() => {
                  setImageFailed(true);
                  setImageLoaded(false);
                }}
              />
            </>
          ) : (
            <div className="absolute inset-0 bg-secondary" />
          )}
        </Link>

        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-6 p-3 sm:p-5 min-w-0">
          <div className="flex-1 min-w-0 space-y-1.5 md:space-y-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/45 font-medium">
              {category}
            </p>
            <Link
              href={`/products/${id}`}
              className="block text-[13px] sm:text-sm md:text-base tracking-wide text-foreground hover:opacity-70 transition-opacity leading-snug"
              title={name}
            >
              {name}
            </Link>
            <p className="text-sm sm:text-base tracking-wide text-foreground font-semibold pt-0.5">
              £{price.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
              <span className="text-[9px] uppercase tracking-wider ml-1.5 font-sans font-medium text-muted-foreground">
                (Inc Vat)
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start md:self-center">
            <button
              type="button"
              onClick={toggleWishlist}
              className="bg-white border border-foreground/15 p-2.5 hover:bg-foreground hover:text-background transition-colors"
              aria-label={
                isWishlisted ? "Remove from wishlist" : "Add to wishlist"
              }
            >
              <Heart
                className={`w-4 h-4 ${isWishlisted ? "fill-red-500 stroke-red-500" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={typeof available === "number" && available <= 0}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-3 sm:px-5 py-2.5 text-[10px] sm:text-[11px] uppercase tracking-[0.14em] font-semibold hover:bg-black hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add to cart</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </div>
      </article>
    );
  }

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

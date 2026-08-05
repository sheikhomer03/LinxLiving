"use client";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { Heart, Loader2, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { cn } from "@/lib/utils";
import {
  CONTACT_HREF,
  PRICE_ON_REQUEST_LABEL,
  isPriceOnRequest,
} from "@/lib/priceOnRequest";

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  image?: string;
  category: string;
  subCategory?: string;
  /** Human type/subcategory label (Linx Glass categoryTypeName) */
  typeName?: string;
  brandName?: string;
  brandSlug?: string;
  sku?: string;
  productCode?: string;
  size?: string;
  salePercent?: number | null;
  stock?: number;
  shopifyVariantId?: string | null;
  /** Catalogue view mode */
  layout?: "grid" | "list";
  /** Show wishlist control (off by default to match Linx Glass shop cards) */
  showWishlist?: boolean;
}

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function saleUnitPrice(price: number, salePercent?: number | null) {
  if (salePercent == null || !(salePercent > 0)) return null;
  return Math.round(price * (1 - salePercent / 100) * 100) / 100;
}

export function ProductCard({
  id,
  name,
  price,
  image = "",
  category = "Product",
  subCategory,
  typeName,
  brandName,
  brandSlug,
  sku,
  productCode,
  size,
  salePercent,
  stock,
  shopifyVariantId,
  layout = "grid",
  showWishlist = false,
}: ProductCardProps) {
  const router = useRouter();
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
  const priceOnRequest = isPriceOnRequest(price, brandName, brandSlug);
  const available =
    typeof stock === "number" ? Math.max(0, stock - cartQty) : undefined;
  // Price-on-request catalogues (e.g. PORCELANOSA) are not sold via cart —
  // £0 / stock 0 must not surface as "Out of stock".
  const outOfStock =
    !priceOnRequest && typeof available === "number" && available <= 0;

  const badgeLabel = sku || productCode || null;
  const onSale =
    !priceOnRequest && typeof salePercent === "number" && salePercent > 0;
  const salePrice = saleUnitPrice(price, salePercent);
  const sizeLabel =
    size?.trim() && size.toLowerCase() !== "n/a" ? size.trim() : null;
  const brandLabel = brandName || category;
  const typeLabel = typeName || subCategory || null;
  const displayPrice = priceOnRequest
    ? PRICE_ON_REQUEST_LABEL
    : onSale && salePrice != null
      ? null
      : formatPrice(price);

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

    if (priceOnRequest) {
      router.push(CONTACT_HREF);
      return;
    }

    if (outOfStock) {
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
      price: salePrice ?? price,
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

  const priceBlock = (
    <div className="min-w-0">
      <p className="text-[10px] text-foreground/45 uppercase tracking-wide">
        {priceOnRequest ? "price" : "inc. VAT"}
      </p>
      <p className="text-base sm:text-lg font-bold text-primary">
        {priceOnRequest ? (
          PRICE_ON_REQUEST_LABEL
        ) : onSale && salePrice != null ? (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs sm:text-sm font-medium text-foreground/45 line-through">
              {formatPrice(price)}
            </span>
            {formatPrice(salePrice)}
          </span>
        ) : (
          displayPrice
        )}
      </p>
    </div>
  );

  const ctaLabel = outOfStock ? "Out of Stock" : "Add to Cart";

  if (layout === "list") {
    return (
      <article className="group flex flex-col sm:flex-row gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-foreground/12 hover:border-primary/40 hover:shadow-md transition-all bg-white overflow-hidden">
        <Link
          href={`/products/${id}`}
          className="relative w-full sm:w-24 h-40 sm:h-24 shrink-0 rounded-lg bg-white border border-foreground/10 overflow-hidden"
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
                sizes="(max-width: 640px) 100vw, 96px"
                className={cn(
                  "object-contain p-1 transition-opacity duration-500",
                  imageLoaded ? "opacity-100" : "opacity-0",
                )}
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

        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-[10px] uppercase tracking-widest text-foreground/45">
            {brandLabel}
            {badgeLabel ? ` · ${badgeLabel}` : ""}
          </p>
          <Link
            href={`/products/${id}`}
            className="block text-sm sm:text-base font-semibold tracking-wide text-foreground hover:text-primary transition-colors leading-snug"
            title={name}
          >
            {name}
          </Link>
          {(sizeLabel || typeLabel) && (
            <p className="text-sm text-foreground/45 line-clamp-1">
              {sizeLabel ?? typeLabel}
            </p>
          )}
        </div>

        <div className="text-left sm:text-right shrink-0 flex flex-col sm:items-end gap-2">
          <div>
            <p className="text-lg font-bold text-primary">
              {priceOnRequest ? (
                PRICE_ON_REQUEST_LABEL
              ) : onSale && salePrice != null ? (
                <>
                  <span className="text-sm font-medium text-foreground/45 line-through block">
                    {formatPrice(price)}
                  </span>
                  {formatPrice(salePrice)}
                </>
              ) : (
                formatPrice(price)
              )}
            </p>
            <p className="text-[10px] text-foreground/45">
              {priceOnRequest ? "price" : "inc. VAT"}
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {showWishlist ? (
              <button
                type="button"
                onClick={toggleWishlist}
                className="bg-white border border-foreground/15 p-2.5 hover:bg-foreground hover:text-background transition-colors rounded-lg"
                aria-label={
                  isWishlisted ? "Remove from wishlist" : "Add to wishlist"
                }
              >
                <Heart
                  className={`w-4 h-4 ${isWishlisted ? "fill-red-500 stroke-red-500" : ""}`}
                />
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={outOfStock}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 bg-foreground text-background px-4 py-2.5 h-9 text-xs font-semibold rounded-lg hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              {ctaLabel}
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group flex flex-col h-full rounded-lg border border-foreground/12 bg-white overflow-hidden transition-all duration-300",
        outOfStock
          ? "opacity-90"
          : "hover:border-foreground/30 hover:shadow-lg",
      )}
    >
      <Link
        href={`/products/${id}`}
        className="relative aspect-square bg-white overflow-hidden border-b border-foreground/10 block"
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
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className={cn(
                "object-contain p-2 transition-opacity duration-500",
                imageLoaded ? "opacity-100" : "opacity-0",
              )}
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

        {badgeLabel ? (
          <span className="absolute top-3 left-3 z-10 pointer-events-none rounded-md border-0 bg-white/90 text-foreground text-[10px] font-bold tracking-wide px-2 py-1 shadow-md">
            {badgeLabel}
          </span>
        ) : null}

        {onSale ? (
          <span className="absolute top-3 right-3 z-10 pointer-events-none rounded-md border-0 bg-[#c41e3a] text-white text-[10px] font-bold px-2 py-1 shadow-md">
            {Math.round(salePercent!)}% off
          </span>
        ) : outOfStock ? (
          <span className="absolute top-3 right-3 z-10 pointer-events-none rounded-md bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-1 shadow-md">
            Out of stock
          </span>
        ) : null}

        {showWishlist ? (
          <button
            type="button"
            onClick={toggleWishlist}
            className="absolute bottom-3 right-3 z-20 bg-white/90 backdrop-blur-sm p-2 rounded-md border border-foreground/5 shadow-sm hover:bg-foreground hover:text-background transition-colors"
            aria-label={
              isWishlisted ? "Remove from wishlist" : "Add to wishlist"
            }
          >
            <Heart
              className={`w-4 h-4 ${isWishlisted ? "fill-red-500 stroke-red-500" : ""}`}
            />
          </button>
        ) : null}
      </Link>

      <div className="flex flex-col flex-1 p-3 sm:p-4">
        <p className="text-[10px] uppercase tracking-widest text-foreground/45 mb-1 line-clamp-1">
          {brandLabel}
        </p>
        {typeLabel ? (
          <p className="text-[10px] text-foreground/40 mb-1 line-clamp-1">
            {typeLabel}
          </p>
        ) : null}
        <Link
          href={`/products/${id}`}
          className="text-xs sm:text-sm font-semibold leading-snug hover:text-primary transition-colors mb-1 min-h-[2.75em] line-clamp-2"
          title={name}
        >
          {name}
        </Link>
        {sizeLabel ? (
          <p className="text-xs text-foreground/45 mb-3">{sizeLabel}</p>
        ) : null}

        <div className="mt-auto pt-3 border-t border-foreground/10 space-y-3">
          {priceBlock}
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={outOfStock}
            className="w-full h-9 sm:h-10 inline-flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-semibold bg-foreground text-background hover:bg-foreground/90 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
            {ctaLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

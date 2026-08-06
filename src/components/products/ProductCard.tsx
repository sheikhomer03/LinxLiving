"use client";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { Check, Loader2, ShoppingBag, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDisplaySize } from "@/lib/sizeBuckets";
import { isAreaSoldCategory } from "@/lib/tileCalculator";
import {
  buildContactEnquiryHref,
  getEnquiryCtaLabel,
  getPriceLabel,
  isPriceOnRequest,
} from "@/lib/priceOnRequest";

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  image?: string;
  category: string;
  /** Human-readable category label when `category` is a slug. */
  categoryName?: string;
  subCategory?: string;
  /** Department slug — decides whether prices read per m². */
  department?: string;
  /** Human type/subcategory label (Linx Glass categoryTypeName) */
  typeName?: string;
  brandName?: string;
  brandSlug?: string;
  /** When "from", shows "From £N" and Add to Cart → Contact. */
  priceMode?: string | null;
  sku?: string;
  productCode?: string;
  size?: string;
  salePercent?: number | null;
  /** Was-price when `price` is already discounted (e.g. Shopify compare-at). */
  compareAtPrice?: number | null;
  /** VAT rate % — 0 → exc. VAT, otherwise inc. VAT. */
  vatRate?: number | null;
  stock?: number;
  shopifyVariantId?: string | null;
  averageRating?: number | null;
  reviewCount?: number | null;
  /** Catalogue view mode */
  layout?: "grid" | "list";
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

function ReviewStars({
  average,
  count,
}: {
  average: number;
  count: number;
}) {
  const filled = count > 0 ? Math.round(average) : 0;
  return (
    <div className="flex items-center gap-1.5 min-h-[1.25rem]">
      <div className="flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => {
          const on = i < filled;
          return (
            <Star
              key={i}
              className={cn(
                "w-3.5 h-3.5",
                on
                  ? "fill-[#f5a623] text-[#f5a623]"
                  : "fill-transparent text-foreground/25",
              )}
            />
          );
        })}
      </div>
      <span className="text-xs text-foreground/50 tabular-nums">
        {count > 0 ? count : "0"}
      </span>
    </div>
  );
}

export function ProductCard({
  id,
  name,
  price,
  image = "",
  category = "Product",
  categoryName,
  subCategory,
  department,
  typeName,
  brandName,
  brandSlug,
  priceMode,
  size,
  salePercent,
  compareAtPrice,
  vatRate = 20,
  stock,
  shopifyVariantId,
  averageRating = 0,
  reviewCount = 0,
  layout = "grid",
}: ProductCardProps) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const cartQty = useCartStore((state) => state.getCartQuantity(id));
  const openCart = useCartDrawerStore((state) => state.open);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageSrc = image?.trim() || "";
  const hasImage = Boolean(imageSrc);
  const priceOnRequest = isPriceOnRequest(
    price,
    brandName,
    brandSlug,
    priceMode,
  );
  const available =
    typeof stock === "number" ? Math.max(0, stock - cartQty) : undefined;
  const outOfStock =
    !priceOnRequest && typeof available === "number" && available <= 0;

  const compareAt =
    compareAtPrice != null &&
    Number.isFinite(Number(compareAtPrice)) &&
    Number(compareAtPrice) > Number(price)
      ? Number(compareAtPrice)
      : null;
  const saleFromPercent = saleUnitPrice(price, salePercent);
  const onSale =
    !priceOnRequest &&
    (compareAt != null ||
      (typeof salePercent === "number" &&
        salePercent > 0 &&
        saleFromPercent != null));
  const displayPrice =
    compareAt != null ? price : onSale && saleFromPercent != null
      ? saleFromPercent
      : price;
  const wasPrice = compareAt != null ? compareAt : onSale ? price : null;

  const areaSold = isAreaSoldCategory({
    department,
    category,
    subCategory,
  });

  const sizeLabel = (() => {
    const raw = size?.trim();
    if (!raw || raw.toLowerCase() === "n/a") return null;
    return formatDisplaySize(raw) || raw;
  })();

  const brandLabel = brandName || null;
  const categoryLabel =
    categoryName ||
    typeName ||
    (subCategory && subCategory !== category ? subCategory : null) ||
    category ||
    null;

  const vatLabel =
    priceOnRequest
      ? null
      : Number(vatRate) === 0
        ? "exc. VAT"
        : "inc. VAT";

  const rating = Number(averageRating) || 0;
  const reviews = Number(reviewCount) || 0;

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [imageSrc]);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (priceOnRequest) {
      router.push(
        buildContactEnquiryHref({
          id,
          name,
          brandName,
          category,
          price,
        }),
      );
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
      price: displayPrice,
      image: imageSrc,
      category,
      stock,
      shopifyVariantId,
      vatRate,
    });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${name} added to your cart`);
    openCart();
  };

  const showImage = hasImage && !imageFailed;
  const perSqm = areaSold ? "/m²" : "";
  const ctaLabel = outOfStock
    ? "Out of Stock"
    : priceOnRequest
      ? getEnquiryCtaLabel(brandName, brandSlug, priceMode)
      : "Add to Cart";

  const priceBlock = (
    <div className="min-w-0 space-y-1">
      {vatLabel ? (
        <p className="text-[11px] text-foreground/45">{vatLabel}</p>
      ) : null}
      {priceOnRequest ? (
        <p className="text-xl font-bold text-[#D3102F] leading-none">
          {getPriceLabel(price, brandName, brandSlug, priceMode)}
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xl font-bold text-[#D3102F] leading-none tabular-nums">
            {formatPrice(displayPrice)}
            {perSqm ? (
              <span className="text-sm font-bold align-top">{perSqm}</span>
            ) : null}
          </span>
          {wasPrice != null ? (
            <span className="text-sm text-foreground/45 line-through tabular-nums">
              Was {formatPrice(wasPrice)}
              {perSqm}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );

  const stockBlock = !priceOnRequest ? (
    <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
      {outOfStock ? (
        <>
          <span className="inline-flex w-4 h-4 items-center justify-center rounded-[3px] bg-foreground/15 text-foreground/55 text-[10px] leading-none">
            –
          </span>
          Out of stock
        </>
      ) : (
        <>
          <Check
            className="w-4 h-4 p-0.5 rounded-[3px] bg-[#1f8a4c] text-white"
            strokeWidth={4}
          />
          In stock
        </>
      )}
    </p>
  ) : (
    <p className="text-[13px] font-medium text-foreground/55">Quote to order</p>
  );

  const metaBlock = (
    <div className="space-y-1.5 min-w-0">
      {brandLabel ? (
        <p className="text-[12px] font-semibold text-foreground/70 line-clamp-1">
          {brandLabel}
        </p>
      ) : null}
      {categoryLabel ? (
        <p className="text-[12px] text-foreground/45 line-clamp-1 capitalize">
          {String(categoryLabel).replace(/-/g, " ")}
        </p>
      ) : null}
      <Link
        href={`/products/${id}`}
        className="block text-[15px] sm:text-base font-bold text-foreground leading-snug hover:text-[#D3102F] transition-colors line-clamp-2"
        title={name}
      >
        {name}
      </Link>
      {sizeLabel ? (
        <p className="text-[13px] text-foreground/45">{sizeLabel}</p>
      ) : null}
    </div>
  );

  const addButton = (
    <button
      type="button"
      onClick={handleAddToCart}
      disabled={outOfStock}
      className="w-full h-10 inline-flex items-center justify-center gap-2 text-[12px] font-bold uppercase tracking-wide bg-foreground text-background hover:bg-foreground/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
      {ctaLabel}
    </button>
  );

  if (layout === "list") {
    return (
      <article className="group flex flex-col sm:flex-row gap-4 p-3 sm:p-4 rounded-xl border border-foreground/12 hover:border-foreground/25 hover:shadow-md transition-all bg-white overflow-hidden">
        <Link
          href={`/products/${id}`}
          className="relative w-full sm:w-36 h-44 sm:h-36 shrink-0 rounded-lg bg-[#f7f7f7] overflow-hidden"
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
                sizes="(max-width: 640px) 100vw, 144px"
                className={cn(
                  "object-cover transition-opacity duration-500",
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
          {onSale ? (
            <span className="absolute top-0 left-0 z-10 bg-[#D3102F] text-white text-[11px] font-bold tracking-wide px-2.5 py-1">
              SALE
            </span>
          ) : null}
        </Link>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {metaBlock}
          {priceBlock}
          {stockBlock}
          <ReviewStars average={rating} count={reviews} />
          <div className="sm:max-w-[220px]">{addButton}</div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group flex flex-col h-full bg-white overflow-hidden transition-all duration-300",
        outOfStock ? "opacity-90" : "hover:shadow-lg",
      )}
    >
      <Link
        href={`/products/${id}`}
        className="relative aspect-[4/3] sm:aspect-square bg-[#f7f7f7] overflow-hidden block"
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
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
              className={cn(
                "object-cover transition-transform duration-500 group-hover:scale-[1.03]",
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

        {onSale ? (
          <span className="absolute top-0 left-0 z-10 pointer-events-none bg-[#D3102F] text-white text-[12px] font-bold tracking-wide px-3 py-1.5">
            SALE
          </span>
        ) : null}
      </Link>

      <div className="flex flex-col flex-1 gap-2.5 p-3 sm:p-4">
        {metaBlock}
        {priceBlock}
        {stockBlock}
        <ReviewStars average={rating} count={reviews} />
        <div className="mt-auto pt-1">{addButton}</div>
      </div>
    </article>
  );
}

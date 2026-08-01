"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Award,
  ChevronRight,
  Heart,
  Minus,
  Phone,
  Plus,
  ShoppingBag,
  Shield,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useWishlistDrawerStore } from "@/store/useWishlistDrawerStore";
import { useModalStore } from "@/store/useModalStore";
import {
  addToWishlist as addToDb,
  removeFromWishlist as removeFromDb,
} from "@/actions/wishlist";
import { ProductGallery } from "@/components/products/ProductGallery";
import { ProductRatingSummary, openProductReviewsTab } from "@/components/products/ProductRatingSummary";
import { ShareButton } from "@/components/products/ShareButton";
import {
  ProductFinishPicker,
  ProductFlashingPicker,
  ProductInsulatingSetPicker,
} from "@/components/products/ProductOptionPickers";
import { MoreFromProducts } from "@/components/products/MoreFromProducts";
import type { MoreFromProduct } from "@/lib/moreFromProducts";
import type { ProductOptionExtra } from "@/lib/productExtras";
import { cn } from "@/lib/utils";
import {
  CONTACT_HREF,
  PRICE_ON_REQUEST_LABEL,
  isPriceOnRequest,
} from "@/lib/priceOnRequest";

export type ProductSectionData = {
  id: string;
  name: string;
  price: number;
  images: string[];
  category: string;
  categoryName?: string;
  categoryHref?: string;
  subCategory?: string;
  subCategoryName?: string;
  brandName?: string;
  brandSlug?: string;
  stock: number;
  shopifyVariantId?: string | null;
  sku?: string;
  productCode?: string;
  size?: string;
  salePercent?: number | null;
  averageRating?: number;
  reviewCount?: number;
  insulatingSetPrice?: number | null;
  finishes?: ProductOptionExtra[];
  flashings?: ProductOptionExtra[];
  moreFromProducts?: MoreFromProduct[];
};

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

function ProductTrustStrip() {
  const items = [
    {
      icon: Award,
      title: "Trade Prices",
      desc: "Always trade prices, never retail markup.",
    },
    {
      icon: Truck,
      title: "UK Delivery",
      desc: "Free shipping on orders over £2000.",
    },
    {
      icon: Shield,
      title: "FENSA Fitting",
      desc: "Professional install available.",
    },
  ];

  return (
    <div className="grid grid-cols-3 border-t border-foreground/10 pt-5 sm:pt-6 mt-6">
      {items.map(({ icon: Icon, title, desc }, index) => (
        <div
          key={title}
          className={cn(
            "min-w-0 px-2 sm:px-4 text-center",
            index > 0 && "border-l border-foreground/10",
          )}
        >
          <div className="mx-auto mb-2 sm:mb-3 flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-foreground/10 bg-white">
            <Icon
              className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-foreground"
              strokeWidth={1.5}
            />
          </div>
          <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide text-foreground leading-tight break-words">
            {title}
          </p>
          <p className="mt-1 sm:mt-1.5 text-[9px] sm:text-[10px] leading-snug text-foreground/50 break-words max-sm:line-clamp-2">
            {desc}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Linx Glass–style product section: sticky gallery + buy box.
 */
export function ProductSection({
  product,
}: {
  product: ProductSectionData;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const onOpen = useModalStore((s) => s.onOpen);
  const addItem = useCartStore((s) => s.addItem);
  const cartQty = useCartStore((s) => s.getCartQuantity(product.id));
  const openCart = useCartDrawerStore((s) => s.open);
  const openWishlist = useWishlistDrawerStore((s) => s.open);
  const {
    addItem: addToWishlist,
    removeItem: removeFromWishlist,
    isInWishlist,
  } = useWishlistStore();

  const [quantity, setQuantity] = useState(1);
  const [mounted, setMounted] = useState(false);
  const finishes = product.finishes || [];
  const flashings = product.flashings || [];
  const offersInsulating =
    product.insulatingSetPrice != null &&
    Number.isFinite(Number(product.insulatingSetPrice));
  const [selectedFinishIndex, setSelectedFinishIndex] = useState<number | null>(
    finishes.length ? 0 : null,
  );
  const [selectedFlashingIndex, setSelectedFlashingIndex] = useState<
    number | null
  >(null);
  const [insulatingSelected, setInsulatingSelected] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setSelectedFinishIndex(finishes.length ? 0 : null);
    setSelectedFlashingIndex(null);
    setInsulatingSelected(false);
  }, [product.id, finishes.length]);

  const priceOnRequest = isPriceOnRequest(
    product.price,
    product.brandName,
    product.brandSlug,
  );
  const available = Math.max(0, (product.stock || 0) - cartQty);
  const outOfStock = !priceOnRequest && available <= 0;
  const maxQty = Math.max(1, available || 1);

  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), maxQty));
  }, [product.id, maxQty]);

  const onSale =
    !priceOnRequest &&
    typeof product.salePercent === "number" &&
    product.salePercent > 0;
  const salePrice = saleUnitPrice(product.price, product.salePercent);
  const baseUnit = salePrice ?? product.price;
  const finishExtra =
    selectedFinishIndex != null
      ? Number(finishes[selectedFinishIndex]?.priceAdjustment) || 0
      : 0;
  const flashingExtra =
    selectedFlashingIndex != null
      ? Number(flashings[selectedFlashingIndex]?.priceAdjustment) || 0
      : 0;
  const insulatingExtra =
    offersInsulating && insulatingSelected
      ? Number(product.insulatingSetPrice) || 0
      : 0;
  const unitPrice = baseUnit + finishExtra + flashingExtra + insulatingExtra;
  const wishlisted = mounted && isInWishlist(product.id);

  const sizeLabel =
    product.size?.trim() && product.size.toLowerCase() !== "n/a"
      ? product.size.trim()
      : null;

  const specChips = useMemo(() => {
    const chips: { label: string; value: string }[] = [];
    if (product.subCategoryName || product.subCategory) {
      chips.push({
        label: "Type",
        value: product.subCategoryName || product.subCategory || "",
      });
    }
    if (sizeLabel) chips.push({ label: "Size", value: sizeLabel });
    if (product.productCode) {
      chips.push({ label: "Code", value: product.productCode });
    }
    return chips.slice(0, 4);
  }, [product, sizeLabel]);

  const handleAddToCart = () => {
    if (priceOnRequest) {
      router.push(CONTACT_HREF);
      return;
    }

    if (outOfStock) {
      toast.error(
        (product.stock || 0) <= 0
          ? "This product is out of stock"
          : "No more stock available to add",
      );
      return;
    }

    const qty = Math.min(quantity, available);
    let added = 0;
    for (let i = 0; i < qty; i++) {
      const result = addItem({
        id: product.id,
        name: product.name,
        price: unitPrice,
        image: product.images[0] || "",
        category: product.category,
        stock: product.stock,
        shopifyVariantId: product.shopifyVariantId,
      });
      if (!result.ok) {
        toast.error(result.error);
        break;
      }
      added++;
    }
    if (added > 0) {
      toast.success(
        added === 1
          ? `${product.name} added to your cart`
          : `${added} × ${product.name} added to your cart`,
      );
      openCart();
    }
  };

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
      addToWishlist({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.images[0] || "",
        category: product.category,
      });
      await addToDb(product.id);
      toast.success(`${product.name} added to your wishlist`);
      openWishlist();
    }
  };

  const brandLabel = product.brandName || "Linx Square";
  const categoryLabel = product.categoryName || product.category;

  return (
    <div className="min-w-0">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-foreground/50 mb-6 sm:mb-8">
        <Link href="/" className="hover:text-foreground transition-colors">
          Home
        </Link>
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        <Link
          href={
            product.brandSlug
              ? `/category?brand=${encodeURIComponent(product.brandSlug)}`
              : "/category"
          }
          className="hover:text-foreground transition-colors"
        >
          Catalogue
        </Link>
        {categoryLabel ? (
          <>
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            <Link
              href={
                product.categoryHref ||
                (product.brandSlug
                  ? `/category?brand=${encodeURIComponent(product.brandSlug)}&category=${encodeURIComponent(product.category)}`
                  : `/category?category=${encodeURIComponent(product.category)}`)
              }
              className="hover:text-foreground transition-colors"
            >
              {categoryLabel}
            </Link>
          </>
        ) : null}
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        <span className="text-foreground font-medium line-clamp-1">
          {product.name}
        </span>
      </nav>

      <div className="grid md:grid-cols-2 gap-8 md:gap-10 lg:gap-14">
        <div className="md:sticky md:top-28 lg:top-32 md:self-start min-w-0">
          <ProductGallery images={product.images} name={product.name} />
          <ProductTrustStrip />
        </div>

        <div className="min-w-0 space-y-5 sm:space-y-6">
          <div>
            <p className="text-sm text-foreground/50 mb-1">
              by{" "}
              <span className="font-semibold text-foreground">{brandLabel}</span>
            </p>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-[2rem] font-serif font-semibold leading-tight text-foreground">
                {product.name}
              </h1>
              <ShareButton />
            </div>

            <ProductRatingSummary
              averageRating={product.averageRating ?? 0}
              reviewCount={product.reviewCount ?? 0}
              onClickReviews={openProductReviewsTab}
              className="mt-3"
            />

            {(product.sku || product.productCode) && (
              <p className="mt-2 text-sm text-foreground/50 break-all">
                {product.productCode && product.sku
                  ? `SKU: ${product.productCode} · ${product.sku}`
                  : `SKU: ${product.productCode || product.sku}`}
              </p>
            )}
          </div>

          <div className="flex items-baseline gap-2 flex-wrap">
            {onSale && product.salePercent != null ? (
              <span className="rounded-md bg-[#c41e3a] text-white text-[10px] font-bold px-2 py-0.5 shadow-sm">
                {Math.round(product.salePercent)}% off
              </span>
            ) : null}
            <span className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground">
              {priceOnRequest ? (
                PRICE_ON_REQUEST_LABEL
              ) : onSale && salePrice != null && salePrice < product.price ? (
                <>
                  <span className="text-xl md:text-2xl font-medium text-foreground/45 line-through mr-2">
                    {formatPrice(product.price + finishExtra + flashingExtra + insulatingExtra)}
                  </span>
                  {formatPrice(unitPrice)}
                </>
              ) : (
                formatPrice(unitPrice)
              )}
            </span>
            <span className="text-sm text-foreground/50">
              {priceOnRequest ? "price on request" : "ex. VAT"}
            </span>
            {!priceOnRequest &&
            (finishExtra > 0 || flashingExtra > 0 || insulatingExtra > 0) ? (
              <span className="text-xs text-foreground/50 w-full">
                Includes selected options (+{" "}
                {formatPrice(finishExtra + flashingExtra + insulatingExtra)})
              </span>
            ) : null}
          </div>

          {specChips.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {specChips.map((chip) => (
                <div
                  key={chip.label}
                  className="inline-flex flex-col rounded-lg border border-foreground/10 bg-[#faf8f3] px-3 py-2 min-w-0 flex-1 basis-[calc(50%-0.25rem)] sm:flex-none sm:min-w-[7rem]"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/45">
                    {chip.label}
                  </span>
                  <span className="text-sm font-semibold text-foreground mt-0.5 break-words">
                    {chip.value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <p
            className={cn(
              "text-sm font-medium",
              priceOnRequest
                ? "text-foreground/70"
                : outOfStock
                  ? "text-destructive"
                  : "text-amber-800",
            )}
          >
            {priceOnRequest
              ? "Price on request — contact us for availability and a quote"
              : outOfStock
                ? cartQty > 0
                  ? "All available units are in your cart"
                  : "Out of stock"
                : `In stock (${available}) — ready for dispatch`}
          </p>

          {sizeLabel ? (
            <div className="rounded-xl border border-foreground/10 bg-[#faf8f3] p-4 sm:p-5">
              <p className="text-sm font-bold text-foreground">Size</p>
              <p className="text-sm text-foreground mt-1 font-medium">
                {sizeLabel}
              </p>
            </div>
          ) : null}

          <ProductFlashingPicker
            flashings={flashings}
            selectedIndex={selectedFlashingIndex}
            onSelect={setSelectedFlashingIndex}
          />

          {offersInsulating ? (
            <ProductInsulatingSetPicker
              price={Number(product.insulatingSetPrice) || 0}
              checked={insulatingSelected}
              onCheckedChange={setInsulatingSelected}
            />
          ) : null}

          <div className="rounded-xl border border-foreground/10 bg-white p-5 space-y-4">
            {!priceOnRequest ? (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-semibold text-foreground">
                  Quantity
                </span>
                <div className="flex items-center border border-foreground/15 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="p-2.5 hover:bg-secondary transition-colors"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-12 text-center text-sm font-semibold">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setQuantity((q) => Math.min(maxQty, q + 1))
                    }
                    disabled={outOfStock || quantity >= maxQty}
                    className="p-2.5 hover:bg-secondary transition-colors disabled:opacity-40"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : null}
            {!priceOnRequest && cartQty > 0 ? (
              <p className="text-xs text-foreground/50">({cartQty} in cart)</p>
            ) : null}

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={outOfStock}
              className="w-full h-12 inline-flex items-center justify-center gap-2 text-base font-bold bg-foreground text-background hover:bg-foreground/90 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ShoppingBag className="w-5 h-5" />
              {outOfStock ? "Out of Stock" : "Add to Cart"}
            </button>

            <button
              type="button"
              onClick={toggleWishlist}
              className="w-full h-11 inline-flex items-center justify-center gap-2 text-sm font-semibold border border-foreground/15 rounded-xl hover:bg-secondary transition-colors"
            >
              <Heart
                className={cn(
                  "w-4 h-4",
                  wishlisted && "fill-red-500 stroke-red-500",
                )}
              />
              {wishlisted ? "Wishlisted" : "Add to Wishlist"}
            </button>
          </div>

          <ProductFinishPicker
            finishes={finishes}
            selectedIndex={selectedFinishIndex}
            onSelect={setSelectedFinishIndex}
          />

          <MoreFromProducts
            categoryLabel={
              product.categoryName || product.category || "this range"
            }
            products={product.moreFromProducts || []}
          />

          <a href="tel:02046342203" className="block">
            <span className="flex w-full h-12 items-center justify-center gap-2 rounded-xl border border-foreground/15 text-sm font-semibold hover:bg-secondary transition-colors">
              <Phone className="w-4 h-4" />
              Call 020 4634 2203
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}

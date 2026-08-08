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
import { ProductProjectCalculator } from "@/components/products/ProductProjectCalculator";
import { ProductSampleRequest } from "@/components/products/ProductSampleRequest";
import {
  isAreaSoldCategory,
  isMadeToMeasure,
  pricePerSqmFrom,
  supportsWallsCalculator,
} from "@/lib/tileCalculator";
import { MadeToMeasureEnquiry } from "@/components/products/MadeToMeasureEnquiry";
import { ProductRatingSummary, openProductReviewsTab } from "@/components/products/ProductRatingSummary";
import { ShareButton } from "@/components/products/ShareButton";
import {
  ProductFinishPicker,
  ProductFlashingPicker,
  ProductInsulatingSetPicker,
} from "@/components/products/ProductOptionPickers";
import { MoreFromProducts } from "@/components/products/MoreFromProducts";
import type { MoreFromProduct, ProductSizeOption } from "@/lib/moreFromProducts";
import type { ProductOptionExtra } from "@/lib/productExtras";
import { cn } from "@/lib/utils";
import { formatDisplaySize } from "@/lib/sizeBuckets";
import {
  buildContactEnquiryHref,
  buildSampleRequestHref,
  getEnquiryCtaLabel,
  getPriceLabel,
  isFromPriceBrand,
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
  /** Department slug — decides calculator vs made-to-measure enquiry. */
  department?: string;
  brandName?: string;
  brandSlug?: string;
  /** When "from", shows "From £N" and Add to Cart → Contact. */
  priceMode?: string | null;
  stock: number;
  shopifyVariantId?: string | null;
  sku?: string;
  productCode?: string;
  size?: string;
  /** Spectra-style SIZE options (current + sibling sizes). */
  sizeOptions?: ProductSizeOption[];
  /** Box coverage spec, e.g. "1.44 SQM" — drives the area calculator. */
  sqmPerBox?: string | number | null;
  /** True when `price` is already per m² (supplier quotes per m², not per pack). */
  priceIsPerSqm?: boolean;
  salePercent?: number | null;
  /** Was-price when `price` is already the discounted figure (e.g. Shopify compare-at). */
  compareAtPrice?: number | null;
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
      desc: "£50 flat rate • up to 20 business days.",
    },
    {
      icon: Shield,
      title: "FENSA Fitting",
      desc: "Professional install available.",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-foreground/10 pt-5 sm:pt-6 mt-6 gap-4 sm:gap-0">
      {items.map(({ icon: Icon, title, desc }, index) => (
        <div
          key={title}
          className={cn(
            "min-w-0 px-2 sm:px-4 text-center",
            index > 0 && "sm:border-l border-foreground/10 border-t sm:border-t-0 pt-4 sm:pt-0",
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
    product.priceMode,
  );
  const available = Math.max(0, (product.stock || 0) - cartQty);
  const outOfStock = !priceOnRequest && available <= 0;
  const maxQty = Math.max(1, available || 1);

  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), maxQty));
  }, [product.id, maxQty]);

  const compareAt =
    product.compareAtPrice != null &&
    Number.isFinite(Number(product.compareAtPrice)) &&
    Number(product.compareAtPrice) > Number(product.price)
      ? Number(product.compareAtPrice)
      : null;
  // When compare-at is present, `price` is already the live sell price — don't
  // apply salePercent again (that double-discounts Spectra Shopify syncs).
  const onSale =
    !priceOnRequest &&
    (compareAt != null ||
      (typeof product.salePercent === "number" && product.salePercent > 0));
  const salePrice =
    compareAt != null
      ? product.price
      : saleUnitPrice(product.price, product.salePercent);
  const baseUnit =
    compareAt != null
      ? product.price
      : (salePrice ?? product.price);
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
  const listPriceForStrike =
    compareAt != null
      ? compareAt + finishExtra + flashingExtra + insulatingExtra
      : product.price + finishExtra + flashingExtra + insulatingExtra;
  const saleBadgePercent =
    compareAt != null
      ? Math.round((1 - product.price / compareAt) * 100)
      : product.salePercent != null
        ? Math.round(product.salePercent)
        : null;
  const isSpectra = product.brandSlug === "spectra";
  const wishlisted = mounted && isInWishlist(product.id);

  const taxonomy = {
    department: product.department,
    category: product.category,
    subCategory: product.subCategory,
  };
  const allowWalls = supportsWallsCalculator(taxonomy);

  // Bespoke ranges (windows, doors, pergolas, awnings) are configured, then
  // quoted by phone. Gated on having no listed price: a stock-sized roof
  // window with a price stays a normal purchase, while the same range without
  // one becomes an enquiry. Price is therefore what decides sell-vs-quote, and
  // the category only decides which enquiry form is the right one.
  const madeToMeasure = priceOnRequest && isMadeToMeasure(taxonomy);

  // Every priced tile / flooring product gets the project calculator —
  // either from box coverage, or from a tiles/flooring department/category.
  // Heating / bathrooms / rooflights stay on the quantity stepper.
  const deptSlug = String(product.department || "").toLowerCase();
  const areaSold =
    !madeToMeasure &&
    !priceOnRequest &&
    unitPrice > 0 &&
    deptSlug !== "heating" &&
    deptSlug !== "bathrooms" &&
    deptSlug !== "rooflights-and-glass" &&
    deptSlug !== "kitchens" &&
    (product.sqmPerBox != null ||
      deptSlug === "tiles" ||
      deptSlug === "flooring" ||
      deptSlug === "outdoor-living" ||
      isAreaSoldCategory(taxonomy));
  const displayPricePerSqm = pricePerSqmFrom(
    unitPrice,
    product.sqmPerBox,
    product.priceIsPerSqm,
  );
  const [areaOrder, setAreaOrder] = useState<{
    orderAreaM2: number;
    total: number;
  } | null>(null);

  const sizeLabel = (() => {
    const raw = product.size?.trim();
    if (!raw || raw.toLowerCase() === "n/a") return null;
    return formatDisplaySize(raw) || raw;
  })();

  const sizeOptions =
    product.sizeOptions && product.sizeOptions.length > 0
      ? product.sizeOptions
      : sizeLabel
        ? [
            {
              id: product.id,
              size: product.size || sizeLabel,
              label: sizeLabel,
              price: product.price,
              isCurrent: true,
            } satisfies ProductSizeOption,
          ]
        : [];

  const specChips = useMemo(() => {
    const chips: { label: string; value: string }[] = [];
    if (product.subCategoryName || product.subCategory) {
      chips.push({
        label: "Type",
        value: product.subCategoryName || product.subCategory || "",
      });
    }
    // Size has its own Spectra-style picker below — don't duplicate in chips.
    if (product.productCode) {
      chips.push({ label: "Code", value: product.productCode });
    }
    return chips.slice(0, 4);
  }, [product]);

  const handleAddToCart = () => {
    if (priceOnRequest) {
      router.push(
        buildContactEnquiryHref({
          id: product.id,
          name: product.name,
          brandName: product.brandName,
          category: product.category,
          price: product.price,
        }),
      );
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

    // Area-sold products go in as a single configured line priced for the
    // whole area, so the basket matches what the calculator quoted.
    if (areaSold) {
      if (!areaOrder || areaOrder.orderAreaM2 <= 0) {
        toast.error("Enter the area you need");
        return;
      }
      const result = addItem({
        id: `${product.id}::${areaOrder.orderAreaM2}m2`,
        name: product.name,
        price: areaOrder.total,
        image: product.images[0] || "",
        category: product.category,
        shopifyVariantId: product.shopifyVariantId,
        isConfigured: true,
        configurationSummary: `${areaOrder.orderAreaM2}m² @ ${formatPrice(displayPricePerSqm)}/m²`,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${areaOrder.orderAreaM2}m² added to cart`);
      openCart();
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
            {onSale && saleBadgePercent != null && saleBadgePercent > 0 ? (
              <span className="rounded-md bg-[#D3102F] text-white text-[10px] font-bold px-2 py-0.5 shadow-sm">
                {saleBadgePercent}% off
              </span>
            ) : null}
            <span className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground">
              {priceOnRequest ? (
                getPriceLabel(
                  product.price,
                  product.brandName,
                  product.brandSlug,
                  product.priceMode,
                )
              ) : onSale &&
                (compareAt != null ||
                  (salePrice != null && salePrice < product.price)) ? (
                <>
                  <span className="text-xl md:text-2xl font-medium text-foreground/45 line-through mr-2">
                    {formatPrice(listPriceForStrike)}
                  </span>
                  {formatPrice(unitPrice)}
                </>
              ) : (
                formatPrice(unitPrice)
              )}
            </span>
            <span className="text-sm text-foreground/50">
              {priceOnRequest
                ? isFromPriceBrand(
                    product.brandSlug,
                    product.brandName,
                    product.priceMode,
                  )
                  ? "guide price"
                  : "price on request"
                : isSpectra
                  ? "per box · inc. VAT"
                  : "inc. VAT"}
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

          {sizeOptions.length > 0 ? (
            <div className="rounded-xl border border-foreground/10 bg-white p-4 sm:p-5 space-y-3">
              <p className="text-sm font-bold uppercase tracking-wide text-foreground">
                Size
              </p>
              <div className="flex flex-wrap gap-2">
                {sizeOptions.map((option) => {
                  const selected = option.isCurrent;
                  const label = option.label || formatDisplaySize(option.size);
                  const showPrice =
                    !priceOnRequest &&
                    Number.isFinite(option.price) &&
                    option.price > 0;
                  return (
                    <button
                      key={`${option.id}-${option.size}`}
                      type="button"
                      disabled={selected}
                      onClick={() => {
                        if (selected || option.id === product.id) return;
                        router.push(`/products/${option.id}`);
                      }}
                      className={cn(
                        "min-w-[7.5rem] rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                        selected
                          ? "border-foreground bg-foreground text-white cursor-default"
                          : "border-foreground/15 bg-[#faf8f3] text-foreground hover:border-foreground/40",
                      )}
                      aria-pressed={selected}
                      aria-label={`Size ${label}${showPrice ? ` ${formatPrice(option.price)}` : ""}`}
                    >
                      <span className="block text-sm font-semibold leading-tight">
                        {label}
                      </span>
                      {showPrice ? (
                        <span
                          className={cn(
                            "mt-0.5 block text-xs",
                            selected ? "text-white/80" : "text-foreground/55",
                          )}
                        >
                          {formatPrice(option.price)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
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

          {/* Bespoke ranges replace the whole buy box: configure, submit, we
              call back with a price. No basket, no checkout. */}
          {madeToMeasure ? (
            <MadeToMeasureEnquiry
              productId={product.id}
              productName={product.name}
              brandName={product.brandName}
            />
          ) : null}

          {/* Area-sold tiles/flooring get the project calculator (box or m²). */}
          {!priceOnRequest && areaSold ? (
            <ProductProjectCalculator
              price={unitPrice}
              size={product.size}
              sqmPerBox={product.sqmPerBox}
              priceIsPerSqm={product.priceIsPerSqm}
              productName={product.name}
              brandName={product.brandName}
              allowWalls={allowWalls}
              disabled={outOfStock}
              onQuantityChange={setAreaOrder}
            />
          ) : null}

          {!madeToMeasure ? (
          <div className="rounded-xl border border-foreground/10 bg-white p-5 space-y-4">
            {!priceOnRequest && !areaSold ? (
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
              {priceOnRequest ? (
                <Phone className="w-5 h-5" />
              ) : (
                <ShoppingBag className="w-5 h-5" />
              )}
              {priceOnRequest
                ? getEnquiryCtaLabel(
                    product.brandName,
                    product.brandSlug,
                    product.priceMode,
                  )
                : outOfStock
                  ? "Out of Stock"
                  : areaSold && areaOrder && areaOrder.total > 0
                    ? `Add to Cart · ${formatPrice(areaOrder.total)}`
                    : "Add to Cart"}
            </button>

            <Link
              href={buildSampleRequestHref({
                id: product.id,
                name: product.name,
                sku: product.sku,
                productCode: product.productCode,
                brandName: product.brandName,
                category: product.category,
                categoryName: product.categoryName,
                price: product.price,
              })}
              className="w-full h-11 inline-flex items-center justify-center gap-2 text-sm font-semibold border border-foreground/15 rounded-xl hover:bg-secondary transition-colors"
            >
              Request sample
            </Link>

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
          ) : null}

          {/* Samples are a request, not a purchase — kept separate from the
              basket so ordering one never implies a sale. */}
          <ProductSampleRequest
            productId={product.id}
            productName={product.name}
            brandName={product.brandName}
          />

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

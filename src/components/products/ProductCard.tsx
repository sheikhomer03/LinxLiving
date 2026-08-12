"use client";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { Loader2, ShoppingBag, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { storefrontBrandLabel } from "@/lib/brandDisplay";
import { PaymentMethodTags } from "@/components/common/PaymentMethodTags";
import { formatDisplaySize } from "@/lib/sizeBuckets";
import { isAreaSoldCategory } from "@/lib/tileCalculator";
import {
  getProductStillImages,
  sanitizeDisplayImageUrl,
} from "@/lib/productImage";
import {
  buildContactEnquiryHref,
  getEnquiryCtaLabel,
  getPriceLabel,
  isPriceOnRequest,
} from "@/lib/priceOnRequest";
import { resolveNaturaPricePerM2 } from "@/lib/naturaPrice";
import { ProductColorSwatches } from "@/components/products/ProductColorSwatches";
import type { ProductColorOption } from "@/lib/productColors";
import { useTradeModeStore } from "@/store/useTradeModeStore";
import { tradeUnitPrice, TRADE_PRICE_TAG } from "@/lib/trade";

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  image?: string;
  /** Full product gallery — when 2+ stills exist, hover shows the next image. */
  images?: string[] | null;
  /** Optional selectable colour variants (swatch + product image). */
  colorOptions?: ProductColorOption[] | null;
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
  /** Force /m² on the price (when the caller already normalised to per-m²). */
  perSqm?: boolean;
  /** Natura Flooring £/m² (preferred over pack `price` for display). */
  pricePerM2?: number | null;
  /** Optional corner badge (e.g. homepage "FREE SAMPLE"). SALE still wins when on sale. */
  badge?: string | null;
  /** Override Add to Cart label (e.g. "Order a free sample"). */
  ctaLabel?: string;
  /** When true, CTA goes to the product page instead of adding to cart. */
  ctaLinkToProduct?: boolean;
  /** True when this product's own sample flow charges for it (e.g. Otto
      Tiles' specs.samplePrice) — suppresses the "FREE SAMPLE" badge. */
  hasPaidSample?: boolean;
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
    <div className="flex items-center gap-1.5 min-h-5">
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
  images = null,
  colorOptions = null,
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
  perSqm: forcePerSqm = false,
  pricePerM2 = null,
  badge = null,
  ctaLabel,
  ctaLinkToProduct = false,
  hasPaidSample = false,
}: ProductCardProps) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const cartQty = useCartStore((state) => state.getCartQuantity(id));
  const openCart = useCartDrawerStore((state) => state.open);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [hoverFailed, setHoverFailed] = useState(false);
  const isTradeMode = useTradeModeStore((state) => state.isTradeMode);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const colors = (colorOptions || []).filter((c) =>
    String(c?.name || "").trim(),
  );
  const [selectedColorIndex, setSelectedColorIndex] = useState<number | null>(
    colors.length ? 0 : null,
  );

  useEffect(() => {
    setSelectedColorIndex(colors.length ? 0 : null);
    setImageLoaded(false);
    setImageFailed(false);
  }, [id, colors.length]);

  const stills = getProductStillImages(images).map((src) =>
    sanitizeDisplayImageUrl(src),
  ).filter(Boolean);
  const fallback = sanitizeDisplayImageUrl(image);
  const colorImage =
    selectedColorIndex != null
      ? sanitizeDisplayImageUrl(
          colors[selectedColorIndex]?.imageUrl || "",
        )
      : "";
  const imageSrc = colorImage || stills[0] || fallback;
  const hoverSrc =
    stills.find((src) => src && src !== imageSrc) ||
    (stills.length > 1 ? stills[1] : "");
  const hasHoverImage =
    !colorImage &&
    Boolean(hoverSrc) &&
    hoverSrc !== imageSrc &&
    !hoverFailed;
  const hasImage = Boolean(imageSrc);
  const naturaM2 = resolveNaturaPricePerM2({
    brandSlug,
    brandName,
    pricePerM2,
  });
  const explicitPricePerM2 = Number(pricePerM2);
  // Natura storefront unit is £/m²; any other supplier that also carries an
  // explicit £/m² spec (e.g. Otto Tiles) uses it too — matches how the
  // product detail page resolves price, so the card never shows the box
  // price mislabelled as a per-m² rate.
  const unitListPrice =
    naturaM2 != null
      ? naturaM2
      : Number.isFinite(explicitPricePerM2) && explicitPricePerM2 > 0
        ? explicitPricePerM2
        : price;
  const priceOnRequest = isPriceOnRequest(
    unitListPrice,
    brandName,
    brandSlug,
    priceMode,
  );
  const available =
    typeof stock === "number" ? Math.max(0, stock - cartQty) : undefined;
  const outOfStock =
    !priceOnRequest && typeof available === "number" && available <= 0;

  // compareAtPrice always arrives at the box/pack level; unitListPrice may
  // have been rescaled to an explicit £/m² rate (Natura, Otto). Scale the
  // "was" figure by the same now/box ratio so it's expressed in the same
  // unit as "now" — otherwise a box-level was-price ends up compared
  // directly against a per-m² now-price (always "greater", but meaningless).
  const rawCompareAt =
    compareAtPrice != null &&
    Number.isFinite(Number(compareAtPrice)) &&
    Number(compareAtPrice) > 0
      ? Number(compareAtPrice)
      : null;
  const scaledCompareAt =
    rawCompareAt != null && Number(price) > 0
      ? Math.round((unitListPrice * (rawCompareAt / Number(price))) * 100) / 100
      : rawCompareAt;
  const compareAt =
    scaledCompareAt != null && scaledCompareAt > Number(unitListPrice)
      ? scaledCompareAt
      : null;
  const saleFromPercent = saleUnitPrice(unitListPrice, salePercent);
  const onSale =
    !priceOnRequest &&
    (compareAt != null ||
      (typeof salePercent === "number" &&
        salePercent > 0 &&
        saleFromPercent != null));
  const displayPrice =
    compareAt != null
      ? unitListPrice
      : onSale && saleFromPercent != null
        ? saleFromPercent
        : unitListPrice;
  const wasPrice =
    compareAt != null ? compareAt : onSale ? unitListPrice : null;

  const saleBadgePercent = (() => {
    if (!onSale) return null;
    if (typeof salePercent === "number" && salePercent > 0) {
      return Math.round(salePercent);
    }
    if (wasPrice != null && wasPrice > displayPrice && displayPrice > 0) {
      return Math.round((1 - displayPrice / wasPrice) * 100);
    }
    return null;
  })();

  // Self-serve Trade Mode (see useTradeModeStore) stacks on top of any sale
  // already reflected in displayPrice. `mounted` avoids a server/client
  // mismatch flash for a returning visitor who left it switched on. The
  // "was" price always stays the true original (list/compare-at) price —
  // `wasPrice` already holds that when a sale is active, so it must not be
  // overwritten with the intermediate sale price; only fall back to
  // displayPrice (== unitListPrice) when there was no sale to begin with.
  const tradeActive = mounted && isTradeMode && !priceOnRequest;
  const tradeNowPrice = tradeActive
    ? tradeUnitPrice(displayPrice, true)
    : displayPrice;
  const tradeWasPrice = tradeActive ? (wasPrice ?? displayPrice) : wasPrice;

  const cornerBadge = onSale
    ? saleBadgePercent
      ? `${saleBadgePercent}% OFF`
      : "SALE"
    : badge || null;

  const areaSold =
    naturaM2 != null ||
    isAreaSoldCategory({
      department,
      category,
      subCategory,
    });

  // Every Tiles / Flooring product can have a free sample requested — flag
  // it on the card so shoppers don't have to open the product to find out.
  // department isn't reliably set on every product, so this rides the same
  // category-keyword check the area calculator uses rather than trusting it.
  // hasPaidSample (e.g. Otto Tiles' specs.samplePrice) suppresses the badge —
  // brand slug isn't reliable here since white-label suppliers like Otto
  // don't appear in the public brand list the card's brandSlug comes from.
  const showSampleBadge = !priceOnRequest && areaSold && !hasPaidSample;

  const sizeLabel = (() => {
    const raw = size?.trim();
    if (!raw || raw.toLowerCase() === "n/a") return null;
    return formatDisplaySize(raw) || raw;
  })();

  // Suppliers are not named on the storefront — see @/lib/brandDisplay.
  const brandLabel = brandName ? storefrontBrandLabel(brandName) : null;
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
    setHoverFailed(false);
  }, [imageSrc, hoverSrc]);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (ctaLinkToProduct) {
      router.push(`/products/${id}`);
      return;
    }

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
  const perSqm = (forcePerSqm || areaSold) ? "/m²" : "";
  const buttonLabel = ctaLinkToProduct
    ? ctaLabel || "View product"
    : outOfStock
      ? "Out of Stock"
      : priceOnRequest
        ? getEnquiryCtaLabel(brandName, brandSlug, priceMode)
        : ctaLabel || "Add to Cart";

  const coverImages = (sizes: string) =>
    showImage ? (
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
          sizes={sizes}
          className={cn(
            "object-cover transition-[opacity,transform] duration-500",
            imageLoaded ? "opacity-100" : "opacity-0",
            hasHoverImage && "group-hover/cover:opacity-0",
          )}
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageFailed(true);
            setImageLoaded(false);
          }}
        />
        {hasHoverImage ? (
          <Image
            src={hoverSrc}
            alt=""
            fill
            sizes={sizes}
            className="object-cover opacity-0 transition-opacity duration-500 group-hover/cover:opacity-100"
            onError={() => setHoverFailed(true)}
          />
        ) : null}
      </>
    ) : (
      <div className="absolute inset-0 bg-secondary" />
    );

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
            {formatPrice(tradeNowPrice)}
            {perSqm ? (
              <span className="text-sm font-bold align-top">{perSqm}</span>
            ) : null}
          </span>
          {tradeWasPrice != null ? (
            <span className="text-sm text-foreground/45 line-through tabular-nums">
              Was {formatPrice(tradeWasPrice)}
              {perSqm}
            </span>
          ) : null}
        </div>
      )}
      {/* Compact marks — no wording, the card has no room for a sentence. */}
      {!priceOnRequest ? (
        <PaymentMethodTags compact className="pt-1.5" />
      ) : null}
    </div>
  );

  const stockBlock = priceOnRequest ? (
    <p className="text-[13px] font-medium text-foreground/55">Quote to order</p>
  ) : outOfStock ? (
    <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
      <span className="inline-flex w-4 h-4 items-center justify-center rounded-[3px] bg-foreground/15 text-foreground/55 text-[10px] leading-none">
        –
      </span>
      Out of stock
    </p>
  ) : null;

  const metaBlock = (
    <div className="space-y-1.5 min-w-0">
      {brandLabel ? (
        <p className="text-[12px] font-semibold text-foreground/70 line-clamp-1">
          {brandLabel}
        </p>
      ) : null}
      <Link
        href={`/products/${id}`}
        className="block text-[15px] sm:text-base font-bold text-foreground leading-snug hover:text-[#D3102F] transition-colors line-clamp-2"
        title={name}
      >
        {name}
        {categoryLabel ? (
          <span className="ml-1.5 inline-flex align-middle items-center rounded-full border border-foreground/15 bg-foreground/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/55">
            {String(categoryLabel).replace(/-/g, " ")}
          </span>
        ) : null}
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
      disabled={!ctaLinkToProduct && outOfStock}
      className="w-full h-10 inline-flex items-center justify-center gap-2 px-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-wide whitespace-nowrap bg-foreground text-background hover:bg-foreground/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-foreground disabled:hover:opacity-40"
    >
      {!ctaLinkToProduct ? (
        <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
      ) : null}
      {buttonLabel}
    </button>
  );

  if (layout === "list") {
    return (
      <article className="group flex flex-col sm:flex-row gap-4 p-3 sm:p-4 rounded-xl border border-foreground/12 hover:border-foreground/25 hover:shadow-md transition-all bg-white overflow-hidden">
        <Link
          href={`/products/${id}`}
          className="group/cover relative w-full sm:w-36 h-44 sm:h-36 shrink-0 rounded-lg bg-[#f7f7f7] overflow-hidden"
        >
          {coverImages("(max-width: 640px) 100vw, 144px")}
          {cornerBadge ? (
            <span className="absolute top-0 left-0 z-10 bg-[#D3102F] text-white text-[11px] font-bold tracking-wide px-2.5 py-1">
              {cornerBadge}
            </span>
          ) : null}
          {showSampleBadge ? (
            <span className="absolute top-0 right-0 z-10 bg-[#D3102F] text-white text-[11px] font-bold tracking-wide px-2.5 py-1 shadow-sm">
              FREE SAMPLE
            </span>
          ) : null}
          {tradeActive ? (
            <span className="absolute bottom-0 left-0 z-10 bg-[#D3102F] text-white text-[11px] font-bold tracking-wide px-2.5 py-1 shadow-sm">
              {TRADE_PRICE_TAG}
            </span>
          ) : null}
        </Link>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {metaBlock}
          <div className="mt-auto flex flex-col gap-2.5 pt-2">
            {priceBlock}
            {stockBlock}
            <ReviewStars average={rating} count={reviews} />
            {colors.length ? (
              <ProductColorSwatches
                colors={colors}
                selectedIndex={selectedColorIndex}
                onSelect={(i) => {
                  setSelectedColorIndex(i);
                  setImageLoaded(false);
                  setImageFailed(false);
                }}
                size="sm"
              />
            ) : null}
            <div className="sm:max-w-55">{addButton}</div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group flex flex-col h-full bg-white border border-foreground/12 overflow-hidden transition-all duration-300 hover:border-foreground/25",
        outOfStock && !ctaLinkToProduct ? "opacity-90" : "hover:shadow-lg",
      )}
    >
      <Link
        href={`/products/${id}`}
        className="group/cover relative aspect-4/3 sm:aspect-square bg-[#f7f7f7] overflow-hidden block"
      >
        {coverImages("(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw")}

        {cornerBadge ? (
          <span className="absolute top-0 left-0 z-10 pointer-events-none bg-[#D3102F] text-white text-[12px] font-bold tracking-wide px-3 py-1.5">
            {cornerBadge}
          </span>
        ) : null}
        {showSampleBadge ? (
          <span className="absolute top-0 right-0 z-10 pointer-events-none bg-[#D3102F] text-white text-[11px] font-bold tracking-wide px-3 py-1.5 shadow-sm">
            FREE SAMPLE
          </span>
        ) : null}
        {tradeActive ? (
          <span className="absolute bottom-0 left-0 z-10 pointer-events-none bg-[#D3102F] text-white text-[11px] font-bold tracking-wide px-3 py-1.5 shadow-sm">
            {TRADE_PRICE_TAG}
          </span>
        ) : null}
      </Link>

      <div className="flex flex-col flex-1 p-3 sm:p-4">
        {metaBlock}
        <div className="mt-auto flex flex-col gap-2.5 pt-3">
          {priceBlock}
          {stockBlock}
          <ReviewStars average={rating} count={reviews} />
          {colors.length ? (
            <ProductColorSwatches
              colors={colors}
              selectedIndex={selectedColorIndex}
              onSelect={(i) => {
                setSelectedColorIndex(i);
                setImageLoaded(false);
                setImageFailed(false);
              }}
              size="sm"
            />
          ) : null}
          {addButton}
        </div>
      </div>
    </article>
  );
}

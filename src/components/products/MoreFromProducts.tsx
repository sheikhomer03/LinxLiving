"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { useTradeModeStore } from "@/store/useTradeModeStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { MoreFromProduct } from "@/lib/moreFromProducts";
import {
  buildContactEnquiryHref,
  getPriceLabel,
  isPriceOnRequest,
} from "@/lib/priceOnRequest";
import { resolveStorefrontUnitPrice } from "@/lib/naturaPrice";
import { isAreaSoldCategory } from "@/lib/tileCalculator";
import { tradeUnitPrice, TRADE_DISCOUNT_PERCENT } from "@/lib/trade";

export type { MoreFromProduct };

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function shortProductName(name: string) {
  return name.replace(/^FAKRO\s+/i, "").split(" in ")[0] ?? name;
}

function saleUnitPrice(price: number, salePercent?: number | null) {
  if (salePercent == null || !(salePercent > 0)) return null;
  return Math.round(price * (1 - salePercent / 100) * 100) / 100;
}

function UpsellCard({ product }: { product: MoreFromProduct }) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const cartQty = useCartStore((s) => s.getCartQuantity(product.id));
  const openCart = useCartDrawerStore((s) => s.open);
  const isTradeMode = useTradeModeStore((s) => s.isTradeMode);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const unit = resolveStorefrontUnitPrice({
    price: product.price,
    brandName: product.brandName,
    brandSlug: product.brandSlug,
    pricePerM2: product.pricePerM2,
  });
  const priceOnRequest = isPriceOnRequest(
    unit.price,
    product.brandName,
    product.brandSlug,
    product.priceMode,
  );
  const available = Math.max(0, (product.stock ?? 0) - cartQty);
  const outOfStock = !priceOnRequest && available <= 0;
  const image = product.image || "";
  const cover = image.includes("cloudinary");

  // Was-price always arrives at the box/pack level; unit.price may have been
  // rescaled to an explicit £/m² rate (Natura, Otto) — scale the compare-at
  // figure by the same ratio so it's expressed in the same unit as "now".
  // Mirrors ProductCard's compareAt handling exactly.
  const rawCompareAt =
    product.compareAtPrice != null && Number(product.compareAtPrice) > 0
      ? Number(product.compareAtPrice)
      : null;
  const scaledCompareAt =
    rawCompareAt != null && Number(product.price) > 0
      ? Math.round((unit.price * (rawCompareAt / Number(product.price))) * 100) / 100
      : rawCompareAt;
  const compareAt =
    scaledCompareAt != null && scaledCompareAt > Number(unit.price)
      ? scaledCompareAt
      : null;
  const saleFromPercent = saleUnitPrice(unit.price, product.salePercent);
  const onSale =
    !priceOnRequest &&
    (compareAt != null ||
      (typeof product.salePercent === "number" &&
        product.salePercent > 0 &&
        saleFromPercent != null));
  const displayPrice =
    compareAt != null
      ? unit.price
      : onSale && saleFromPercent != null
        ? saleFromPercent
        : unit.price;
  const wasPrice = compareAt != null ? compareAt : onSale ? unit.price : null;

  const saleBadgePercent = (() => {
    if (!onSale) return null;
    if (typeof product.salePercent === "number" && product.salePercent > 0) {
      return Math.round(product.salePercent);
    }
    if (wasPrice != null && wasPrice > displayPrice && displayPrice > 0) {
      return Math.round((1 - displayPrice / wasPrice) * 100);
    }
    return null;
  })();

  const tradeActive = mounted && isTradeMode && !priceOnRequest;
  const tradeNowPrice = tradeActive
    ? tradeUnitPrice(displayPrice, true)
    : displayPrice;
  const tradeWasPrice = tradeActive ? (wasPrice ?? displayPrice) : wasPrice;

  const cornerBadge = onSale
    ? saleBadgePercent
      ? `${saleBadgePercent}% OFF`
      : "SALE"
    : null;
  // Card is always narrow (2-3 up grid), so trade discount folds into the
  // same top-left badge rather than getting its own corner — matches
  // ProductCard's mobileCornerBadge fold, applied unconditionally here.
  const foldedCornerBadge = !tradeActive
    ? cornerBadge
    : saleBadgePercent
      ? `${saleBadgePercent}% + ${TRADE_DISCOUNT_PERCENT}% OFF`
      : cornerBadge
        ? `${cornerBadge} + ${TRADE_DISCOUNT_PERCENT}%`
        : `${TRADE_DISCOUNT_PERCENT}% OFF`;

  const showSampleBadge =
    !priceOnRequest &&
    isAreaSoldCategory({
      department: product.department,
      category: product.category,
      subCategory: product.subCategory,
    }) &&
    !product.hasPaidSample;

  const handleAdd = () => {
    if (priceOnRequest) {
      router.push(
        buildContactEnquiryHref({
          id: product.id,
          name: product.name,
          brandName: product.brandName,
          category: product.category,
          price: unit.price,
        }),
      );
      return;
    }
    if (outOfStock) {
      toast.error(
        cartQty > 0
          ? "All available units are already in your cart"
          : "Out of stock",
      );
      return;
    }
    const result = addItem({
      id: product.id,
      name: product.name,
      price: displayPrice,
      image,
      category: product.category || "product",
      department: product.department ?? null,
      stock: product.stock,
      shopifyVariantId: product.shopifyVariantId || undefined,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    openCart();
    toast.success("Added to cart");
  };

  return (
    <div className="flex flex-col rounded-lg border border-foreground/10 bg-white overflow-hidden h-full">
      <Link
        href={`/products/${product.id}`}
        className="relative aspect-square bg-white border-b border-foreground/10 block"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={shortProductName(product.name)}
            className={cn(
              "absolute inset-0 h-full w-full",
              cover ? "object-cover" : "object-contain",
            )}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-foreground/40">
            No image
          </span>
        )}
        {foldedCornerBadge ? (
          <span className="absolute top-0 left-0 z-10 pointer-events-none bg-[#D3102F] text-white text-[9px] font-bold tracking-wide leading-tight px-1.5 py-1 max-w-[85%]">
            {foldedCornerBadge}
          </span>
        ) : null}
        {showSampleBadge ? (
          <span className="absolute bottom-0 right-0 z-10 pointer-events-none bg-[#D3102F] text-white text-[9px] font-bold tracking-wide px-1.5 py-1 shadow-sm">
            FREE SAMPLE
          </span>
        ) : null}
      </Link>
      <div className="flex flex-col flex-1 bg-[#f7f7f7]">
        <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/45">
          {product.brandName || "Product"}
        </p>
        <Link
          href={`/products/${product.id}`}
          className="text-xs font-bold text-foreground leading-snug hover:opacity-70 transition-opacity mt-0.5"
        >
          {shortProductName(product.name)}
        </Link>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm font-bold text-foreground">
          {priceOnRequest ? (
            getPriceLabel(
              unit.price,
              product.brandName,
              product.brandSlug,
              product.priceMode,
            )
          ) : (
            <>
              <span>
                {formatPrice(tradeNowPrice)}
                {unit.perSqm ? "/m²" : ""}
              </span>
              {tradeWasPrice != null ? (
                <span className="text-[11px] font-semibold text-foreground/45 line-through">
                  Was {formatPrice(tradeWasPrice)}
                  {unit.perSqm ? "/m²" : ""}
                </span>
              ) : null}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={handleAdd}
          disabled={outOfStock}
          className="mt-auto w-full h-9 px-1 flex items-center justify-center text-center text-[10px] font-bold uppercase tracking-normal whitespace-nowrap border border-foreground text-foreground hover:bg-foreground hover:text-background rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-foreground disabled:hover:opacity-40"
        >
          {outOfStock ? "Out of Stock" : "Add to Cart"}
        </button>
      </div>
    </div>
  );
}

export function MoreFromProducts({
  products,
}: {
  products: MoreFromProduct[];
}) {
  if (!products.length) return null;

  return (
    <section className="rounded-xl border border-foreground/10 bg-[#f5f5f5] p-5">
      <h3 className="text-base font-bold text-foreground mb-4">
        More Suggestions
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {products.map((product) => (
          <UpsellCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

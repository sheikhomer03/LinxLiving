"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Ruler, ShoppingBag, Check } from "lucide-react";
import { storefrontBrandLabel } from "@/lib/brandDisplay";
import { toast } from "sonner";
import { ProductGallery } from "@/components/products/ProductGallery";
import {
  ProductFinishPicker,
  ProductFlashingPicker,
  ProductInsulatingSetPicker,
} from "@/components/products/ProductOptionPickers";
import type { ProductOptionExtra } from "@/lib/productExtras";
import {
  parseSizeToMm,
  quoteCustomSizePrice,
} from "@/lib/configuratorSizePrice";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import {
  buildContactEnquiryHref,
  getEnquiryCtaLabel,
  getPriceLabel,
  isPriceOnRequest,
} from "@/lib/priceOnRequest";
import { cn } from "@/lib/utils";

export type RealConfiguratorProduct = {
  id: string;
  name: string;
  price: number;
  images: string[];
  category: string;
  stock: number;
  shopifyVariantId?: string | null;
  size?: string;
  brandName?: string;
  insulatingSetPrice?: number | null;
  finishes: ProductOptionExtra[];
  flashings: ProductOptionExtra[];
  description?: string;
  sizeOptions?: {
    id: string;
    size: string;
    price: number;
    name?: string;
    stock?: number;
    shopifyVariantId?: string | null;
    image?: string;
  }[];
  variants?: {
    id: string;
    name: string;
    price: number | null;
    stock?: number | null;
    imageUrl?: string;
  }[];
};

function money(n: number) {
  return `£${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function RealProductConfigurator({
  product,
  departmentSlug,
  departmentName,
}: {
  product: RealConfiguratorProduct;
  departmentSlug?: string;
  departmentName?: string;
}) {
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartDrawerStore((s) => s.open);
  const finishes = product.finishes || [];
  const flashings = product.flashings || [];
  const sizeOptions = product.sizeOptions || [];
  const hasInsulating =
    product.insulatingSetPrice != null &&
    Number.isFinite(Number(product.insulatingSetPrice));

  const variants = product.variants || [];
  const refParsed =
    parseSizeToMm(product.size) ||
    parseSizeToMm(product.name) ||
    null;

  const [sizeMode, setSizeMode] = useState<"listed" | "custom">(
    refParsed ? "custom" : "listed",
  );
  const [selectedSizeId, setSelectedSizeId] = useState(product.id);
  const [widthMm, setWidthMm] = useState(
    refParsed ? String(refParsed.widthMm) : "",
  );
  const [heightMm, setHeightMm] = useState(
    refParsed ? String(refParsed.heightMm) : "",
  );
  const [variantIndex, setVariantIndex] = useState<number | null>(
    variants.length ? 0 : null,
  );
  const [finishIndex, setFinishIndex] = useState<number | null>(
    finishes.length ? 0 : null,
  );
  const [flashingIndex, setFlashingIndex] = useState<number | null>(null);
  const [insulating, setInsulating] = useState(false);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    const next =
      parseSizeToMm(product.size) || parseSizeToMm(product.name) || null;
    setSelectedSizeId(product.id);
    setVariantIndex(variants.length ? 0 : null);
    setFinishIndex(finishes.length ? 0 : null);
    setFlashingIndex(null);
    setInsulating(false);
    setQty(1);
    if (next) {
      setWidthMm(String(next.widthMm));
      setHeightMm(String(next.heightMm));
      setSizeMode("custom");
    } else {
      setWidthMm("");
      setHeightMm("");
      setSizeMode(sizeOptions.length > 1 ? "listed" : "custom");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const selectedSize =
    sizeOptions.find((o) => o.id === selectedSizeId) ||
    (product.size
      ? {
          id: product.id,
          size: product.size,
          price: product.price,
          name: product.name,
          stock: product.stock,
          shopifyVariantId: product.shopifyVariantId,
          image: product.images[0],
        }
      : null);

  const selectedVariant =
    variantIndex != null ? variants[variantIndex] : null;

  const pricePoints = useMemo(() => {
    const pts = (sizeOptions.length ? sizeOptions : selectedSize ? [selectedSize] : [])
      .map((o) => {
        const p = parseSizeToMm(o.size);
        if (!p || isPriceOnRequest(o.price)) return null;
        return {
          widthMm: p.widthMm,
          heightMm: p.heightMm,
          price: o.price,
        };
      })
      .filter(Boolean) as {
      widthMm: number;
      heightMm: number;
      price: number;
    }[];
    return pts;
  }, [sizeOptions, selectedSize]);

  const customQuote = useMemo(() => {
    if (sizeMode !== "custom" || !refParsed) return null;
    if (isPriceOnRequest(product.price)) {
      return {
        ok: false as const,
        error: "Price on request",
        widthMm: 0,
        heightMm: 0,
        areaM2: 0,
        price: 0,
      };
    }
    const widths = pricePoints.map((p) => p.widthMm);
    const heights = pricePoints.map((p) => p.heightMm);
    return quoteCustomSizePrice({
      widthMm: Number(widthMm),
      heightMm: Number(heightMm),
      reference: {
        widthMm: refParsed.widthMm,
        heightMm: refParsed.heightMm,
        price: product.price,
        label: product.size || `${refParsed.widthMm}×${refParsed.heightMm} mm`,
      },
      points: pricePoints,
      minWidthMm: widths.length
        ? Math.max(200, Math.min(...widths) - 200)
        : undefined,
      maxWidthMm: widths.length
        ? Math.max(...widths) + 400
        : undefined,
      minHeightMm: heights.length
        ? Math.max(200, Math.min(...heights) - 200)
        : undefined,
      maxHeightMm: heights.length
        ? Math.max(...heights) + 400
        : undefined,
    });
  }, [
    sizeMode,
    refParsed,
    widthMm,
    heightMm,
    product.price,
    product.size,
    pricePoints,
  ]);

  const listedBase =
    sizeOptions.length > 1 && selectedSize
      ? selectedSize.price
      : selectedVariant?.price != null
        ? selectedVariant.price
        : selectedSize?.price ?? product.price;

  const baseUnit =
    sizeMode === "custom" && customQuote?.ok
      ? customQuote.price
      : listedBase;

  const finishExtra =
    finishIndex != null
      ? Number(finishes[finishIndex]?.priceAdjustment) || 0
      : 0;
  const flashingExtra =
    flashingIndex != null
      ? Number(flashings[flashingIndex]?.priceAdjustment) || 0
      : 0;
  const insulatingExtra =
    hasInsulating && insulating ? Number(product.insulatingSetPrice) || 0 : 0;

  const unit = baseUnit + finishExtra + flashingExtra + insulatingExtra;
  const isCustomSized =
    sizeMode === "custom" &&
    Boolean(customQuote?.ok) &&
    refParsed != null &&
    (Number(widthMm) !== refParsed.widthMm ||
      Number(heightMm) !== refParsed.heightMm);

  const activeStock = isCustomSized
    ? 999
    : typeof selectedSize?.stock === "number"
      ? selectedSize.stock
      : product.stock;

  const canCustomSize = Boolean(refParsed) && !isPriceOnRequest(product.price);
  const hasConfigurableOptions =
    canCustomSize ||
    sizeOptions.length > 1 ||
    variants.length > 0 ||
    finishes.length > 0 ||
    flashings.length > 0 ||
    hasInsulating;

  const onRequest =
    isPriceOnRequest(product.price) ||
    (sizeMode === "custom" && customQuote != null && !customQuote.ok);

  const total = unit * qty;
  const displayName =
    sizeMode === "listed" ? selectedSize?.name || product.name : product.name;
  const galleryImages =
    sizeMode === "listed" &&
    selectedSize?.image &&
    selectedSize.id !== product.id
      ? [
          selectedSize.image,
          ...product.images.filter((i) => i !== selectedSize.image),
        ]
      : product.images;

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (sizeMode === "custom" && customQuote?.ok) {
      parts.push(`Custom ${customQuote.widthMm} × ${customQuote.heightMm} mm`);
    } else if (selectedSize?.size) {
      parts.push(`Size ${selectedSize.size}`);
    } else if (product.size) {
      parts.push(`Size ${product.size}`);
    }
    if (selectedVariant && sizeMode === "listed" && sizeOptions.length <= 1) {
      parts.push(`Option: ${selectedVariant.name}`);
    } else if (selectedVariant && sizeMode === "custom") {
      parts.push(`Option: ${selectedVariant.name}`);
    }
    if (finishIndex != null && finishes[finishIndex]) {
      parts.push(`Finish: ${finishes[finishIndex].name}`);
    }
    if (flashingIndex != null && flashings[flashingIndex]) {
      parts.push(`Flashing: ${flashings[flashingIndex].name}`);
    }
    if (insulating) parts.push("Insulating set");
    return parts.join(" · ");
  }, [
    sizeMode,
    customQuote,
    selectedSize,
    product.size,
    selectedVariant,
    sizeOptions.length,
    finishIndex,
    finishes,
    flashingIndex,
    flashings,
    insulating,
  ]);

  const onSelectListedSize = (opt: NonNullable<typeof sizeOptions>[number]) => {
    setSelectedSizeId(opt.id);
    setSizeMode("listed");
    const p = parseSizeToMm(opt.size);
    if (p) {
      setWidthMm(String(p.widthMm));
      setHeightMm(String(p.heightMm));
    }
  };

  const onAdd = () => {
    if (isPriceOnRequest(product.price, product.brandName)) {
      toast.message("Contact us to order — guide pricing only");
      return;
    }
    if (sizeMode === "custom") {
      if (!customQuote?.ok) {
        toast.error(customQuote?.error || "Enter a valid size in mm");
        return;
      }
    } else if (activeStock <= 0) {
      toast.error("This product is currently out of stock");
      return;
    }

    const cartId =
      sizeMode === "custom" && customQuote?.ok
        ? `cfg:${product.id}:${customQuote.widthMm}x${customQuote.heightMm}`
        : selectedSize?.id || product.id;
    const cartName = displayName;
    const cartImage =
      (sizeMode === "listed" ? selectedSize?.image : null) ||
      product.images[0] ||
      "";
    const cartShopify =
      sizeMode === "custom"
        ? null
        : (selectedSize?.shopifyVariantId ?? product.shopifyVariantId);

    let ok = true;
    for (let i = 0; i < qty; i++) {
      const result = addItem({
        id: cartId,
        name: cartName,
        price: unit,
        image: cartImage,
        category: product.category,
        stock: activeStock,
        shopifyVariantId: cartShopify,
        isConfigured: true,
        configurationSummary: summary || undefined,
        configWidthMm:
          sizeMode === "custom" && customQuote?.ok
            ? customQuote.widthMm
            : undefined,
        configHeightMm:
          sizeMode === "custom" && customQuote?.ok
            ? customQuote.heightMm
            : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        ok = false;
        break;
      }
    }
    if (ok) {
      toast.success("Configured product added to cart");
      openCart();
    }
  };

  const sizeStepDone =
    sizeMode === "custom"
      ? Boolean(customQuote?.ok)
      : Boolean(selectedSize?.size || product.size);

  const addDisabled =
    sizeMode === "custom"
      ? !customQuote?.ok
      : activeStock <= 0 || isPriceOnRequest(product.price);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
      <div className="lg:col-span-7 space-y-6">
        <ProductGallery images={galleryImages} name={displayName} />

        {product.description ? (
          <div className="border border-foreground/10 p-5 md:p-6 space-y-2">
            <h2 className="text-[11px] uppercase tracking-[0.2em] font-bold">
              About this product
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line line-clamp-8">
              {product.description.replace(/<[^>]+>/g, " ").trim()}
            </p>
          </div>
        ) : null}
      </div>

      <aside className="lg:col-span-5">
        <div className="lg:sticky lg:top-28 space-y-5">
          <div className="border border-foreground/10 bg-white p-5 md:p-6 space-y-5 shadow-[0_16px_48px_rgba(0,0,0,0.05)]">
            <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
              {departmentName ? (
                <Link
                  href={`/configurator/${departmentSlug}`}
                  className="hover:text-foreground"
                >
                  {departmentName}
                </Link>
              ) : null}
              {product.brandName ? (
                <span className="text-primary">
                  {storefrontBrandLabel(product.brandName)}
                </span>
              ) : null}
            </div>

            <h1 className="font-serif text-2xl md:text-3xl tracking-wide leading-tight">
              {displayName}
            </h1>

            <div className="flex items-end justify-between gap-3 border-b border-foreground/8 pb-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary mb-1">
                  Live price
                </p>
                <p className="font-serif text-3xl tracking-wide tabular-nums transition-all">
                  {sizeMode === "custom" && customQuote && !customQuote.ok
                    ? "—"
                    : onRequest &&
                        isPriceOnRequest(
                          product.price,
                          product.brandName,
                        )
                      ? getPriceLabel(product.price, product.brandName)
                      : money(total)}
                </p>
                {sizeMode === "custom" && customQuote && !customQuote.ok ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {customQuote.error}
                  </p>
                ) : null}
                {sizeMode === "custom" && customQuote?.ok ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {customQuote.areaM2} m²
                    {customQuote.anchorLabel
                      ? ` · ${customQuote.anchorLabel}`
                      : ""}
                  </p>
                ) : null}
                {!onRequest && qty > 1 ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {money(unit)} each · qty {qty}
                  </p>
                ) : null}
                {!onRequest &&
                (finishExtra || flashingExtra || insulatingExtra) ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Size {money(baseUnit)} + options{" "}
                    {money(finishExtra + flashingExtra + insulatingExtra)}
                  </p>
                ) : null}
              </div>
              {isCustomSized || activeStock <= 0 ? (
                <p
                  className={cn(
                    "text-[10px] uppercase tracking-[0.14em] font-bold",
                    isCustomSized ? "text-amber-700" : "text-red-600",
                  )}
                >
                  {isCustomSized ? "Made to size" : "Out of stock"}
                </p>
              ) : null}
            </div>

            <ol className="grid grid-cols-3 gap-2">
              {[
                { n: 1, label: "Size", done: sizeStepDone },
                { n: 2, label: "Options", done: hasConfigurableOptions },
                { n: 3, label: "Order", done: false },
              ].map((s) => (
                <li
                  key={s.n}
                  className={cn(
                    "flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold px-2 py-2 border",
                    s.done
                      ? "border-foreground/20 bg-secondary/40"
                      : "border-foreground/10 text-muted-foreground",
                  )}
                >
                  {s.done ? (
                    <Check className="w-3 h-3 text-primary" />
                  ) : (
                    <span className="w-4 h-4 rounded-full border border-foreground/20 flex items-center justify-center text-[9px]">
                      {s.n}
                    </span>
                  )}
                  {s.label}
                </li>
              ))}
            </ol>

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Ruler className="w-4 h-4 text-primary" />
                  <h2 className="text-[11px] uppercase tracking-[0.2em] font-bold">
                    Size
                  </h2>
                </div>
                {canCustomSize && sizeOptions.length > 1 ? (
                  <div className="flex border border-foreground/15 text-[10px] uppercase tracking-[0.12em] font-bold">
                    <button
                      type="button"
                      onClick={() => setSizeMode("listed")}
                      className={cn(
                        "px-2.5 py-1.5",
                        sizeMode === "listed"
                          ? "bg-foreground text-background"
                          : "hover:bg-secondary",
                      )}
                    >
                      Listed
                    </button>
                    <button
                      type="button"
                      onClick={() => setSizeMode("custom")}
                      className={cn(
                        "px-2.5 py-1.5",
                        sizeMode === "custom"
                          ? "bg-foreground text-background"
                          : "hover:bg-secondary",
                      )}
                    >
                      Custom mm
                    </button>
                  </div>
                ) : null}
              </div>

              {sizeOptions.length > 1 && sizeMode === "listed" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {sizeOptions.map((opt) => {
                    const selected = opt.id === selectedSizeId;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSelectListedSize(opt)}
                        className={cn(
                          "border px-3 py-2.5 text-center text-sm transition-colors",
                          selected
                            ? "border-foreground bg-foreground text-background"
                            : "border-foreground/15 hover:border-foreground/40",
                        )}
                      >
                        <span className="block font-semibold tabular-nums">
                          {opt.size}
                        </span>
                        {!isPriceOnRequest(opt.price) ? (
                          <span className="block text-[10px] mt-0.5 opacity-70">
                            {money(opt.price)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {canCustomSize &&
              (sizeMode === "custom" || sizeOptions.length <= 1) ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Enter outside frame size in millimetres. Live price is
                    calculated from this product’s real listed size and price
                    {pricePoints.length > 1
                      ? " (and sibling SKUs when available)"
                      : ""}
                    .
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <label
                      className="block space-y-2 rounded-lg p-3"
                      style={{
                        border: "2px solid hsl(var(--primary) / 0.45)",
                        background: "hsl(var(--primary) / 0.06)",
                      }}
                    >
                      <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-primary">
                        Width (mm)
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={200}
                        step={1}
                        value={widthMm}
                        onChange={(e) => {
                          setSizeMode("custom");
                          setWidthMm(e.target.value);
                        }}
                        className="w-full px-3 py-3 text-base font-semibold tabular-nums"
                        style={{
                          border: "2px solid #9ca3af",
                          background: "#fff",
                          borderRadius: "0.5rem",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                        }}
                      />
                    </label>
                    <label
                      className="block space-y-2 rounded-lg p-3"
                      style={{
                        border: "2px solid hsl(var(--primary) / 0.45)",
                        background: "hsl(var(--primary) / 0.06)",
                      }}
                    >
                      <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-primary">
                        Height (mm)
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={200}
                        step={1}
                        value={heightMm}
                        onChange={(e) => {
                          setSizeMode("custom");
                          setHeightMm(e.target.value);
                        }}
                        className="w-full px-3 py-3 text-base font-semibold tabular-nums"
                        style={{
                          border: "2px solid #9ca3af",
                          background: "#fff",
                          borderRadius: "0.5rem",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                        }}
                      />
                    </label>
                  </div>
                  {refParsed ? (
                    <p className="text-[11px] text-muted-foreground">
                      Listed reference: {refParsed.widthMm} ×{" "}
                      {refParsed.heightMm} mm · {money(product.price)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!canCustomSize && sizeOptions.length <= 1 ? (
                product.size ? (
                  <p className="border border-foreground/10 bg-secondary/30 px-4 py-3 text-sm font-semibold tabular-nums">
                    {product.size}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This product has no listed size, so custom mm pricing isn’t
                    available.
                  </p>
                )
              ) : null}
            </section>

            {variants.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-[11px] uppercase tracking-[0.2em] font-bold">
                  Options
                </h2>
                <div className="grid grid-cols-1 gap-2">
                  {variants.map((v, index) => {
                    const selected = variantIndex === index;
                    const priceLabel =
                      v.price != null && !isPriceOnRequest(v.price)
                        ? money(v.price)
                        : null;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVariantIndex(index)}
                        className={cn(
                          "flex items-center justify-between gap-3 border px-4 py-3 text-left text-sm transition-colors",
                          selected
                            ? "border-foreground bg-foreground text-background"
                            : "border-foreground/15 hover:border-foreground/40",
                        )}
                      >
                        <span className="font-medium">{v.name}</span>
                        {priceLabel ? (
                          <span className="tabular-nums shrink-0 text-[12px] opacity-80">
                            {priceLabel}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {!hasConfigurableOptions ? (
              <p className="text-sm text-muted-foreground leading-relaxed border border-dashed border-foreground/15 px-4 py-3">
                This product has a single listed price and no size data for
                custom mm quoting.
              </p>
            ) : null}

            {finishes.length ? (
              <ProductFinishPicker
                finishes={finishes}
                selectedIndex={finishIndex}
                onSelect={setFinishIndex}
              />
            ) : null}

            {flashings.length ? (
              <ProductFlashingPicker
                flashings={flashings}
                selectedIndex={flashingIndex}
                onSelect={setFlashingIndex}
              />
            ) : null}

            {hasInsulating ? (
              <ProductInsulatingSetPicker
                price={Number(product.insulatingSetPrice) || 0}
                checked={insulating}
                onCheckedChange={setInsulating}
              />
            ) : null}

            {summary ? (
              <p className="text-[11px] text-muted-foreground leading-snug border-t border-foreground/8 pt-4">
                {summary}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <div className="flex items-center border border-foreground/15">
                <button
                  type="button"
                  className="px-3 py-2.5 text-sm hover:bg-secondary"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-10 text-center text-sm font-bold tabular-nums">
                  {qty}
                </span>
                <button
                  type="button"
                  className="px-3 py-2.5 text-sm hover:bg-secondary"
                  onClick={() =>
                    setQty((q) =>
                      Math.min(isCustomSized ? 99 : activeStock || 99, q + 1),
                    )
                  }
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              {isPriceOnRequest(product.price, product.brandName) ? (
                <Link
                  href={buildContactEnquiryHref({
                    id: product.id,
                    name: product.name,
                    brandName: product.brandName,
                    category: product.category,
                    price: product.price,
                  })}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-foreground text-background px-5 py-3.5 text-[11px] uppercase tracking-[0.18em] font-bold"
                >
                  {getEnquiryCtaLabel(product.brandName)}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onAdd}
                  disabled={addDisabled}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-foreground text-background px-5 py-3.5 text-[11px] uppercase tracking-[0.18em] font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  <ShoppingBag className="w-4 h-4" />
                  Add to cart
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

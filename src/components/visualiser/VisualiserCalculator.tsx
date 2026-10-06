"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { useTradeScope } from "@/hooks/useTradeScope";
import { productSale } from "@/lib/productSale";
import { parsePositiveNumber } from "@/lib/ottoTilesCalculator";
import { pricePerSqmFrom, supportsWallsCalculator } from "@/lib/tileCalculator";
import { tradeAppliesTo, tradeUnitPrice } from "@/lib/trade";
import { buildContactEnquiryHref, getEnquiryCtaLabel, isPriceOnRequest } from "@/lib/priceOnRequest";
import { ProductProjectCalculator } from "@/components/products/ProductProjectCalculator";
import { NaturaAreaConfigurator } from "@/components/products/NaturaAreaConfigurator";
import { DirectFlooringConfigurator } from "@/components/products/DirectFlooringConfigurator";
import { FlooringSalesConfigurator } from "@/components/products/FlooringSalesConfigurator";
import { LuxuryFlooringConfigurator } from "@/components/products/LuxuryFlooringConfigurator";
import { TileMountainConfigurator } from "@/components/products/TileMountainConfigurator";
import { Floors4TradeRoomCalculator } from "@/components/products/Floors4TradeRoomCalculator";
import {
  ProductVariantPicker,
  settleSelection,
  variantOptionAt,
  type CatalogVariant,
  type VariantAxis,
} from "@/components/products/ProductVariantPicker";
import type { CalculatorProduct } from "@/lib/visualiser/calculatorProduct";

/**
 * The product page's quantity calculator, for the design on the floor.
 *
 * Every figure below is derived exactly as ProductSection derives it for a
 * flooring product with no option picked (no finish, flashing or add-on
 * extras), and the same configurator renders with the same props: Natura,
 * Direct Flooring Online, Flooring Sales, Luxury Flooring, Tile Mountain,
 * Floors4Trade, or the project calculator for everyone else (Topps priced off
 * the Colour / Finish / Size picked in the product page's own picker). The cart line is the one the product page adds, and the
 * server re-prices it from the product's own rate at checkout.
 *
 * If ProductSection's pricing changes, change it here to match.
 */

type AreaOrder = {
  orderAreaM2: number;
  total: number;
  packs?: number;
  requestedM2?: number;
  zoneLabel?: string;
};

const noopSubscribe = () => () => {};

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function VisualiserCalculator({
  product,
  scannedAreaM2,
  onAdded,
}: {
  product: CalculatorProduct;
  /** What the photo suggests — shown as a hint; the customer enters the area. */
  scannedAreaM2: number | null;
  onAdded?: () => void;
}) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartDrawerStore((s) => s.open);
  // Persisted cart: held at 0 until mounted, as on the product page.
  const storedCartQty = useCartStore((s) => s.getCartQuantity(product.id));
  // False on the server and during hydration, true once in the browser.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const cartQty = mounted ? storedCartQty : 0;
  const tradeScope = useTradeScope();
  // One calculator per product: the drawer mounts a fresh one for each.
  const [areaOrder, setAreaOrder] = useState<AreaOrder | null>(null);

  const priceOnRequest = isPriceOnRequest(product.price, product.brandName, product.brandSlug, product.priceMode);
  const available = Math.max(0, (product.stock || 0) - cartQty);
  const outOfStock = !priceOnRequest && available <= 0;

  const brandName = String(product.brandName || "");
  const isTopps = product.brandSlug === "topps-tiles" || /^topps\s*tiles/i.test(brandName);

  // --- Topps size picker (ProductSection: variantAxes … selectedVariant) -----
  // Colour, then Finish, then the sizes that finish comes in; defaulting to
  // the first variant the supplier can actually ship.
  const catalogVariants = product.catalogVariants as CatalogVariant[];
  const variantAxes = useMemo<VariantAxis[]>(
    () =>
      (product.shopifyOptions || []).filter(
        (a) => a?.name && !/^title$/i.test(String(a.name)) && (a.values || []).length > 0,
      ),
    [product.shopifyOptions],
  );
  const pickerAxes = useMemo(() => {
    if (!isTopps) return variantAxes;
    const rank = (name: string) => (/colou?r/i.test(name) ? 0 : /finish/i.test(name) ? 1 : /size/i.test(name) ? 2 : 3);
    return [...variantAxes].sort((a, b) => rank(a.name) - rank(b.name));
  }, [isTopps, variantAxes]);
  // Only Topps prices off a picked variant here; other flooring sells as one.
  const hasVariantPicker = isTopps && variantAxes.length > 0 && catalogVariants.length > 1;
  const [variantSelection, setVariantSelection] = useState<Record<string, string>>(() => {
    if (!hasVariantPicker) return {};
    const lead = catalogVariants.find((v) => v.available !== false) || catalogVariants[0];
    const next: Record<string, string> = {};
    variantAxes.forEach((axis, i) => {
      next[axis.name] = variantOptionAt(lead, Number(axis.position) || i + 1) || (axis.values || [])[0] || "";
    });
    return next;
  });
  const selectedVariant = useMemo(() => {
    if (!hasVariantPicker) return null;
    return (
      catalogVariants.find((v) =>
        variantAxes.every((axis, i) => {
          const want = String(variantSelection[axis.name] || "").toLowerCase();
          if (!want) return true;
          return variantOptionAt(v, Number(axis.position) || i + 1).toLowerCase() === want;
        }),
      ) || null
    );
  }, [hasVariantPicker, catalogVariants, variantAxes, variantSelection]);

  // --- price (ProductSection: activePrice … listUnitPrice, no extras picked) --
  const activePrice = Number(selectedVariant?.price) > 0 ? Number(selectedVariant?.price) : product.price;
  const sale = useMemo(
    () => productSale({ price: product.price, compareAtPrice: product.compareAtPrice, salePercent: product.salePercent }),
    [product.price, product.compareAtPrice, product.salePercent],
  );
  // A variant Shopify synced its own compare-at for already carries its "Was".
  const variantCompareAt =
    selectedVariant &&
    selectedVariant.compareAtPrice != null &&
    Number.isFinite(Number(selectedVariant.compareAtPrice)) &&
    Number(selectedVariant.compareAtPrice) > Number(activePrice)
      ? Number(selectedVariant.compareAtPrice)
      : null;
  const compareAt = variantCompareAt ?? sale.was(activePrice);
  const onSale = !priceOnRequest && compareAt != null;
  const baseUnit = variantCompareAt != null ? activePrice : sale.now(activePrice);
  const unitPrice = baseUnit;
  const listPriceForStrike = compareAt ?? activePrice;

  // --- which supplier calculator (ProductSection's brand checks) -------------
  const isNatura = product.brandSlug === "natura-flooring" || /^natura\b/i.test(brandName);
  const isDfo = product.brandSlug === "direct-flooring-online" || /direct\s*flooring\s*online/i.test(brandName);
  const isFsl = product.brandSlug === "flooring-sales" || /flooring\s*sales/i.test(brandName);
  const isOtto = product.brandSlug === "otto-tiles" || /^otto\s*tiles/i.test(brandName);
  const isF4t = product.brandSlug === "floors4trade" || /floors\s*4\s*trade/i.test(brandName);
  const isTilesPorcelain = product.brandSlug === "tiles-porcelain" || /tiles\s*porcelain/i.test(brandName);
  const isLuxuryFlooring = product.brandSlug === "luxury-flooring" || /^luxury[\s-]*flooring/i.test(brandName);
  const isTileMountain = product.brandSlug === "tile-mountain" || /^tile\s*mountain/i.test(brandName);

  const taxonomy = { department: product.department, category: product.category, subCategory: product.subCategory };
  const allowWalls = supportsWallsCalculator(taxonomy);
  const deptSlug = String(product.department || "").toLowerCase();

  const naturaPricePerM2 = (() => {
    const fromSpec = Number(product.pricePerM2);
    if (Number.isFinite(fromSpec) && fromSpec > 0) return fromSpec;
    const derived = pricePerSqmFrom(unitPrice, product.sqmPerBox);
    return derived > 0 ? derived : unitPrice;
  })();
  const dfoPackCoverage = (() => {
    const n = Number(product.packCoverageM2);
    if (Number.isFinite(n) && n > 0) return n;
    const fromBox = Number(product.sqmPerBox);
    return Number.isFinite(fromBox) && fromBox > 0 ? fromBox : 0;
  })();
  const dfoPricePerM2 = (() => {
    const fromSpec = Number(product.pricePerM2);
    if (Number.isFinite(fromSpec) && fromSpec > 0) return fromSpec;
    return unitPrice > 0 ? unitPrice : 0;
  })();
  const dfoPricePerPack = (() => {
    const fromSpec = Number(product.pricePerPack);
    if (Number.isFinite(fromSpec) && fromSpec > 0) return fromSpec;
    if (dfoPackCoverage > 0 && dfoPricePerM2 > 0) return Math.round(dfoPricePerM2 * dfoPackCoverage * 100) / 100;
    return 0;
  })();
  const luxuryPackCoverage = isLuxuryFlooring ? parsePositiveNumber(product.sqmPerBox) || 0 : 0;
  const hasLuxuryConfig = luxuryPackCoverage > 0 && unitPrice > 0;
  const tmUnitLabel = String(product.orderUnit || "").trim() || "Tiles";
  const tmIsPack = /pack/i.test(tmUnitLabel);
  const tmCoverage = (() => {
    if (tmIsPack) return parsePositiveNumber(product.sqmPerBox) || 0;
    const perSqm = parsePositiveNumber(product.tilesPerSqm) || 0;
    return perSqm > 0 ? 1 / perSqm : 0;
  })();
  const tmPricePerSqm =
    parsePositiveNumber(product.sheetPricePerM2) || parsePositiveNumber(product.pricePerM2) || unitPrice;
  const tmUnitPrice = (() => {
    const stated = parsePositiveNumber(product.unitPrice);
    if (stated) return stated;
    return tmCoverage > 0 ? Math.round(tmPricePerSqm * tmCoverage * 100) / 100 : unitPrice;
  })();
  const hasTileMountainConfig = isTileMountain && tmCoverage > 0 && tmPricePerSqm > 0 && tmUnitPrice > 0;
  const ottoPricePerM2 = (() => {
    const fromSpec = Number(product.pricePerM2);
    if (Number.isFinite(fromSpec) && fromSpec > 0) return fromSpec;
    return unitPrice > 0 ? unitPrice : 0;
  })();

  // Topps: priced off the picked variant (or its only one).
  const toppsVariant = isTopps
    ? (selectedVariant || (catalogVariants.length === 1 ? catalogVariants[0] : null))
    : null;
  const toppsCalc = (() => {
    if (!toppsVariant) return null;
    // The Topps fields ProductSection reads off a variant row.
    const v = toppsVariant as CatalogVariant & {
      attributes?: { label?: string; value?: string }[];
      sellUnit?: string;
      coverageM2?: number | string;
    };
    const attr = (label: string) => (v.attributes || []).find((a: { label?: string }) => a?.label === label)?.value;
    const soldPer = String(attr("Sold per") || v.sellUnit || "");
    const unit = /box/i.test(soldPer) ? "Box" : /sheet/i.test(soldPer) ? "Sheet" : /tile/i.test(soldPer) ? "Tile" : "";
    if (!unit) return null;
    const coverage =
      parsePositiveNumber(attr(`Coverage per ${unit.toLowerCase()} (m²)`)) || parsePositiveNumber(v.coverageM2) || 0;
    if (!(coverage > 0) || !(unitPrice > 0)) return null;
    return {
      unitLabel: unit === "Box" ? "Boxes" : unit === "Sheet" ? "Sheets" : "Tiles",
      coverageM2: coverage,
      pricePerSqm: Math.round((unitPrice / coverage) * 100) / 100,
    };
  })();
  const toppsNeedsSize = isTopps && !toppsCalc;

  const areaSold = isTopps
    ? Boolean(toppsCalc) && !priceOnRequest
    : !priceOnRequest &&
      !product.soldPerUnit &&
      (isOtto
        ? ottoPricePerM2 > 0
        : isDfo
          ? dfoPackCoverage > 0 && dfoPricePerPack > 0
          : isNatura
            ? naturaPricePerM2 > 0
            : unitPrice > 0 &&
              deptSlug !== "heating" &&
              deptSlug !== "bathrooms" &&
              deptSlug !== "rooflights-and-glass" &&
              deptSlug !== "kitchens");

  const displayPricePerSqm = toppsCalc
    ? toppsCalc.pricePerSqm
    : isOtto
      ? ottoPricePerM2
      : isDfo
        ? dfoPricePerM2
        : isNatura
          ? naturaPricePerM2
          : (parsePositiveNumber(product.pricePerM2) ?? pricePerSqmFrom(unitPrice, product.sqmPerBox, product.priceIsPerSqm));
  const displayWasPricePerSqm =
    onSale && compareAt != null && baseUnit > 0
      ? Math.round(displayPricePerSqm * (compareAt / baseUnit) * 100) / 100
      : null;

  // Trade preview and "Was" scaling, as on the product page.
  const pdpDisplayedPrice = priceOnRequest ? null : isNatura || isDfo || isOtto ? displayPricePerSqm : unitPrice;
  const tradeActive =
    mounted &&
    tradeAppliesTo(product.department, tradeScope) &&
    !priceOnRequest &&
    pdpDisplayedPrice != null &&
    pdpDisplayedPrice > 0;
  const pdpOriginalPrice = priceOnRequest
    ? null
    : isNatura || isDfo || isOtto
      ? (displayWasPricePerSqm ?? displayPricePerSqm)
      : listPriceForStrike;
  const originalMultiplier =
    pdpOriginalPrice != null && pdpDisplayedPrice != null && pdpDisplayedPrice > 0
      ? pdpOriginalPrice / pdpDisplayedPrice
      : 1;

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
      toast.error((product.stock || 0) <= 0 ? "This product is out of stock" : "No more stock available to add");
      return;
    }
    if (!areaOrder || areaOrder.orderAreaM2 <= 0) {
      toast.error("Enter the area you need");
      return;
    }
    // The product page's area line: one configured line priced for the area.
    const packs = areaOrder.packs || 0;
    const summary =
      isOtto && packs > 0
        ? `${packs} box${packs === 1 ? "" : "es"} · ${areaOrder.orderAreaM2}m²`
        : (isDfo || isLuxuryFlooring) && packs > 0
          ? `${packs} pack${packs === 1 ? "" : "s"} · ${areaOrder.orderAreaM2}m² covered`
          : `${areaOrder.orderAreaM2}m² @ ${formatPrice(displayPricePerSqm)}/m²`;
    const result = addItem({
      id: `${product.id}::${areaOrder.orderAreaM2}m2`,
      name: product.name,
      price: areaOrder.total,
      image: product.image || "",
      category: product.category,
      department: product.department ?? null,
      productId: product.id,
      shopifyVariantId: product.shopifyVariantId,
      isConfigured: true,
      configurationSummary: summary,
      // Billed area (already rounded up to whole packs) — the server
      // multiplies it by the product's own £/m² rate.
      configKind: "area",
      configAreaM2: areaOrder.orderAreaM2,
      ...(packs > 0 ? { configPacks: packs } : {}),
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      isOtto && packs > 0
        ? `${packs} box${packs === 1 ? "" : "es"} (${areaOrder.orderAreaM2}m²) added to cart`
        : (isDfo || isLuxuryFlooring) && packs > 0
          ? `${packs} pack${packs === 1 ? "" : "s"} added to cart`
          : `${areaOrder.orderAreaM2}m² added to cart`,
    );
    openCart();
    onAdded?.();
  };

  // Topps: Colour / Finish / Size, the product page's own picker and rules.
  const picker = hasVariantPicker ? (
    <ProductVariantPicker
      axes={pickerAxes}
      variants={catalogVariants}
      selection={variantSelection}
      onlyRealCombinations
      onSelect={(axis, value) => {
        setVariantSelection((prev) => settleSelection(pickerAxes, catalogVariants, { ...prev, [axis]: value }, axis));
        // A different size is a different order.
        setAreaOrder(null);
      }}
    />
  ) : null;

  // --- not sold by area here: say where to buy it ---------------------------
  if (priceOnRequest || toppsNeedsSize || !areaSold) {
    return (
      <div className="space-y-3">
        {picker}
        <p className="text-sm text-black/70">
          {priceOnRequest
            ? "This floor is priced on request."
            : toppsNeedsSize
              ? "This option isn't sold by area here. Choose another option above, or see the product page."
              : "This floor's quantity is worked out on its product page."}
        </p>
        {priceOnRequest ? (
          <button
            type="button"
            onClick={handleAddToCart}
            className="font-menu inline-flex h-12 w-full items-center justify-center bg-black text-[12px] font-medium uppercase tracking-[0.6px] text-white transition-opacity hover:opacity-90"
          >
            {getEnquiryCtaLabel(product.brandName, product.brandSlug, product.priceMode)}
          </button>
        ) : (
          <Link
            href={`/products/${product.id}`}
            className="font-menu inline-flex h-12 w-full items-center justify-center bg-black text-[12px] font-medium uppercase tracking-[0.6px] text-white transition-opacity hover:opacity-90"
          >
            Go to product page
          </Link>
        )}
      </div>
    );
  }

  const ready = Boolean(areaOrder && areaOrder.orderAreaM2 > 0);

  return (
    <div className="space-y-5">
      {picker}
      {scannedAreaM2 ? (
        <p className="rounded-md bg-[#f3f3f1] px-3 py-2 text-xs text-black/70">
          Your photo suggests about <strong className="text-black">{scannedAreaM2} m²</strong> of floor. Measure your
          room for an exact figure.
        </p>
      ) : null}

      {/* The product page's configurators, chosen and wired the same way. */}
      {isNatura ? (
        <NaturaAreaConfigurator
          pricePerM2={displayPricePerSqm}
          packCoverageM2={Number(product.sqmPerBox) || null}
          disabled={outOfStock}
          onQuantityChange={setAreaOrder}
          tradeActive={tradeActive}
          originalMultiplier={originalMultiplier}
        />
      ) : null}

      {isDfo ? (
        <DirectFlooringConfigurator
          addonGroups={product.addonGroups as never}
          pricePerPack={dfoPricePerPack}
          packCoverageM2={dfoPackCoverage}
          pricePerM2={dfoPricePerM2}
          productId={product.id}
          productName={product.name}
          brandName={product.brandName}
          sku={product.sku || product.productCode}
          category={product.category}
          categoryName={product.category}
          disabled={outOfStock}
          onQuantityChange={setAreaOrder}
          onAddToBasket={handleAddToCart}
          tradeActive={tradeActive}
          originalMultiplier={originalMultiplier}
        />
      ) : null}

      {isFsl && dfoPricePerPack > 0 ? (
        <FlooringSalesConfigurator
          addonGroups={product.addonGroups as never}
          pricePerPack={dfoPricePerPack}
          packCoverageM2={dfoPackCoverage}
          stockLabel=""
          disabled={outOfStock}
          onChange={({ packs, coveredM2, total }) =>
            setAreaOrder(packs > 0 ? { orderAreaM2: coveredM2, total, packs } : null)
          }
        />
      ) : null}

      {hasLuxuryConfig ? (
        <LuxuryFlooringConfigurator
          coverage={luxuryPackCoverage}
          pricePerPack={unitPrice}
          productName={product.name}
          disabled={outOfStock}
          onQuantityChange={setAreaOrder}
          tradeActive={tradeActive}
          originalMultiplier={originalMultiplier}
        />
      ) : null}

      {hasTileMountainConfig ? (
        <TileMountainConfigurator
          pricePerSqm={tmPricePerSqm}
          unitPrice={tmUnitPrice}
          unitLabel={tmUnitLabel}
          coverageM2={tmCoverage}
          minFullPack={Boolean(product.minFullPack)}
          productName={product.name}
          disabled={outOfStock}
          onQuantityChange={({ orderAreaM2, total, packs }) =>
            setAreaOrder(packs > 0 ? { orderAreaM2, total, packs } : null)
          }
          tradeActive={tradeActive}
          originalMultiplier={originalMultiplier}
        />
      ) : null}

      {isF4t && dfoPackCoverage > 0 ? (
        <Floors4TradeRoomCalculator
          packPrice={unitPrice}
          packCoverageM2={dfoPackCoverage}
          productName={product.name}
          disabled={outOfStock}
          onQuantityChange={({ packs, areaM2, total }) =>
            setAreaOrder(packs > 0 ? { orderAreaM2: areaM2, total, packs } : null)
          }
        />
      ) : null}

      {!isNatura && !isDfo && !isFsl && !isOtto && !isF4t && !hasLuxuryConfig && !hasTileMountainConfig ? (
        <ProductProjectCalculator
          // A new Topps size is a new calculation (its own coverage and price).
          key={selectedVariant ? `${selectedVariant.option1}|${selectedVariant.option2}|${selectedVariant.option3}` : "base"}
          price={unitPrice}
          size={product.size}
          sqmPerBox={toppsCalc ? toppsCalc.coverageM2 : product.sqmPerBox}
          priceIsPerSqm={toppsCalc ? false : product.priceIsPerSqm}
          pricePerM2={toppsCalc ? toppsCalc.pricePerSqm : parsePositiveNumber(product.pricePerM2)}
          productId={product.id}
          productName={product.name}
          brandName={product.brandName}
          allowWalls={allowWalls}
          disabled={outOfStock}
          onQuantityChange={setAreaOrder}
          tradeActive={tradeActive}
          originalMultiplier={originalMultiplier}
          soldByTile={toppsCalc ? toppsCalc.unitLabel === "Tiles" : isTilesPorcelain}
          tilesPerSqm={toppsCalc && toppsCalc.unitLabel === "Tiles" ? 1 / toppsCalc.coverageM2 : product.tilesPerSqm}
        />
      ) : null}

      {/* Direct Flooring's configurator has its own Add to basket (as on the
          product page), so the shared button is left off for it. */}
      {!isDfo ? (
      <div className="sticky bottom-0 -mx-4 border-t border-black/10 bg-white px-4 pb-1 pt-3">
        {!ready ? (
          <p className="mb-2 text-xs text-black/55">Enter your measurements above to see how much you need.</p>
        ) : null}
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={outOfStock || !ready}
          className="font-menu inline-flex h-12 w-full items-center justify-center gap-2 bg-black text-[12px] font-medium uppercase tracking-[0.6px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShoppingBag className="h-5 w-5" />
          {outOfStock
            ? "Out of Stock"
            : areaOrder && areaOrder.total > 0
              ? `Add to Cart · ${formatPrice(tradeActive ? tradeUnitPrice(areaOrder.total, true) : areaOrder.total)}`
              : "Add to Cart"}
        </button>
      </div>
      ) : null}
    </div>
  );
}

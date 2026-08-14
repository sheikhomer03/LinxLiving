"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Award,
  ChevronRight,
  Heart,
  Mail,
  Minus,
  Phone,
  Plus,
  ShoppingBag,
  Shield,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { useSafeSession } from "@/hooks/useSafeSession";
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
import { ProductSupportPanel } from "@/components/support/ProductSupportPanel";
import {
  ProductFinishSwatches,
  type FinishSwatchGroup,
} from "@/components/products/ProductFinishSwatches";
import {
  ProductSupplierSections,
  type SupplierSection,
  type SupplierInfoDropdown,
} from "@/components/products/ProductSupplierSections";
import {
  ProductVariantPicker,
  variantOptionAt,
  type CatalogVariant,
} from "@/components/products/ProductVariantPicker";
import {
  ProductAddOns,
  type ProductAddOn,
} from "@/components/products/ProductAddOns";
import { storefrontBrandLabel } from "@/lib/brandDisplay";
import {
  PaymentMethodTags,
  KlarnaInstalmentNote,
} from "@/components/common/PaymentMethodTags";
import { NaturaAreaConfigurator } from "@/components/products/NaturaAreaConfigurator";
import { DirectFlooringConfigurator } from "@/components/products/DirectFlooringConfigurator";
import { FlooringSalesConfigurator } from "@/components/products/FlooringSalesConfigurator";
import { OttoTilesConfigurator } from "@/components/products/OttoTilesConfigurator";
import {
  PookyConfigurator,
  type PookySelection,
} from "@/components/products/PookyConfigurator";
import { SpectraLarsenConfigurator } from "@/components/products/SpectraLarsenConfigurator";
import { UfhsConfigurator } from "@/components/products/UfhsConfigurator";
import {
  deriveTilesPerSqmFromSize,
  parsePositiveNumber,
} from "@/lib/ottoTilesCalculator";
import {
  hasPookyOptions,
  type PookyEfficiency,
  type PookyOptionItem,
} from "@/lib/productPookySections";
import {
  hasUfhsConfigurator,
  type UfhsCoverage,
  type UfhsDoTheJobRight,
  type UfhsOptionElement,
  type UfhsOptionField,
  type UfhsOptionInfo,
  type UfhsShopifyOption,
  type UfhsVariantRow,
} from "@/lib/productUfhsSections";
import {
  inferSpectraLarsenKind,
  isLarsenColourName,
  isSpectraAdhesiveGroutCategory,
} from "@/lib/spectraLarsenCalculator";
import {
  ProductFeaturePacking,
  type FeaturePackingEntry,
} from "@/components/products/ProductFeaturePacking";
import { ProductColorSwatches } from "@/components/products/ProductColorSwatches";
import { ProductSizeSwatches } from "@/components/products/ProductSizeSwatches";
import { ProductDownloads } from "@/components/products/ProductDownloads";
import { ProductFilesDocumentation } from "@/components/products/ProductFilesDocumentation";
import type { ProductColorOption } from "@/lib/productColors";
import type { ProductSizeEntry } from "@/lib/productSizes";
import type { ProductDownloadItem } from "@/lib/productDownloads";
import type { FilesDocumentationSection } from "@/lib/productFilesDocumentation";
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
  ProductAddonCheckboxList,
  RoofPitchPicker,
} from "@/components/products/ProductOptionPickers";
import { MoreFromProducts } from "@/components/products/MoreFromProducts";
import type { MoreFromProduct, ProductSizeOption } from "@/lib/moreFromProducts";
import type { ProductOptionExtra } from "@/lib/productExtras";
import { cn } from "@/lib/utils";
import { formatDisplaySize } from "@/lib/sizeBuckets";
import { useTradeModeStore } from "@/store/useTradeModeStore";
import { tradeUnitPrice, TRADE_DISCOUNT_PERCENT } from "@/lib/trade";
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
  /** Explicit £/m² (Natura Flooring) — used by the Natura m² configurator. */
  pricePerM2?: number | null;
  /** Direct Flooring Online pack calculator inputs. */
  packCoverageM2?: number | null;
  pricePerPack?: number | null;
  /** True when `price` is already per m² (supplier quotes per m², not per pack). */
  priceIsPerSqm?: boolean;
  /** Otto Tiles calculator: tiles in one box / tiles covering 1 m². */
  tilesPerBox?: number | null;
  tilesPerSqm?: number | null;
  samplePrice?: number | null;
  /** Otto-style paid sample (specs.samplePrice/source/ottoId/ottoHandle) — suppresses the free-sample tag. */
  hasPaidSample?: boolean;
  leadTimeLabel?: string | null;
  leadTimeDetail?: string | null;
  salePercent?: number | null;
  /** Was-price when `price` is already the discounted figure (e.g. Shopify compare-at). */
  compareAtPrice?: number | null;
  averageRating?: number;
  reviewCount?: number;
  insulatingSetPrice?: number | null;
  finishes?: ProductOptionExtra[];
  flashings?: ProductOptionExtra[];
  moreFromProducts?: MoreFromProduct[];
  /** Optional Porcelanosa-style Features rows. */
  featureEntries?: FeaturePackingEntry[];
  /** Optional Porcelanosa-style Packing rows. */
  packingEntries?: FeaturePackingEntry[];
  /** Optional legal disclaimer text. */
  legalDisclaimer?: string | null;
  /** Optional selectable colour variants. */
  colorOptions?: ProductColorOption[];
  /** Optional admin size variants (name + image) on this product. */
  productSizes?: ProductSizeEntry[];
  /** Pooky lamp bases / shades / pendants / wall fittings / efficiency. */
  bases?: PookyOptionItem[];
  shades?: PookyOptionItem[];
  pendants?: PookyOptionItem[];
  wallFittings?: PookyOptionItem[];
  efficiency?: PookyEfficiency | null;
  productType?: string | null;
  /** Underfloor Heating Store configurator / sections. */
  coverage?: UfhsCoverage | null;
  nestedOptions?: UfhsOptionField[];
  doTheJobRight?: UfhsDoTheJobRight | null;
  optionInfo?: UfhsOptionInfo[];
  optionElements?: UfhsOptionElement[];
  shopifyOptions?: UfhsShopifyOption[];
  ufhsVariants?: UfhsVariantRow[];
  /** True when UFHS PDP includes the Measure My Room calculator. */
  hasMeasureMyRoom?: boolean | null;
  /** Promo strip shown above the buy box. */
  promoBanner?: { image?: string; url?: string; alt?: string } | null;
  /** Lights-off gallery shot (supplier "lights out" toggle). */
  darkModeImage?: string;
  /** Supplier stock line, e.g. "Available on backorder". */
  stockAvailabilityText?: string;
  /** Supplier add-on form (m² calculator wording). */
  addonGroups?: { heading?: string; fields?: { type?: string; label?: string }[] }[];
  /** Optional Noken-style Downloads (icon grid). */
  downloads?: ProductDownloadItem[];
  /** Optional Porcelanosa-style Files and Documentation sections. */
  filesDocumentation?: FilesDocumentationSection[];
  /** Finishes sold as sibling products, shown as swatches under the price. */
  swatchGroups?: FinishSwatchGroup[];
  /** Supplier variant rows, picked through `shopifyOptions` axes. */
  catalogVariants?: CatalogVariant[];
  /** "Add-ons for this product", shown under the gallery as the supplier does. */
  addOns?: ProductAddOn[];
  addOnsHeading?: string;
  /** Supplier PDP accordions, shown under "Need help with this product?". */
  supplierSections?: SupplierSection[];
  /** Explainer dropdowns beside the option picker (e.g. switch types). */
  infoDropdowns?: SupplierInfoDropdown[];
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
    <div className="grid grid-cols-3 border-t border-foreground/10 pt-4 sm:pt-6 mt-6 gap-1 sm:gap-0">
      {items.map(({ icon: Icon, title, desc }, index) => (
        <div
          key={title}
          className={cn(
            "min-w-0 px-1 sm:px-4 text-center",
            index > 0 && "border-l border-foreground/10",
          )}
        >
          <div className="mx-auto mb-1.5 sm:mb-3 flex h-7 w-7 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-foreground/10 bg-white">
            <Icon
              className="h-3 w-3 sm:h-4 sm:w-4 text-foreground"
              strokeWidth={1.5}
            />
          </div>
          <p className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wide text-foreground leading-tight wrap-break-word">
            {title}
          </p>
          <p className="mt-1 sm:mt-1.5 text-[8px] sm:text-[10px] leading-snug text-foreground/50 wrap-break-word line-clamp-2 sm:line-clamp-none">
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
  support,
}: {
  product: ProductSectionData;
  /** Optional — when supplied, a "Need help with this product?" panel is
      shown under the buy box. Nothing else on the page depends on it. */
  support?: {
    phone: string;
    phoneHref: string;
    email: string;
    hours?: string;
  };
}) {
  const router = useRouter();
  const { data: session } = useSafeSession();
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
  const isTradeMode = useTradeModeStore((s) => s.isTradeMode);
  /** Finish being hovered in the swatch row, previewed in the gallery. */
  const [swatchPreview, setSwatchPreview] = useState("");
  const finishes = product.finishes || [];
  const flashings = product.flashings || [];
  const isSpectraLarsenCategory = isSpectraAdhesiveGroutCategory({
    brandSlug: product.brandSlug,
    category: product.category,
    categoryName: product.categoryName,
  });
  const larsenKind = isSpectraLarsenCategory
    ? inferSpectraLarsenKind({
        name: product.name,
        category: product.category,
        categoryName: product.categoryName,
      })
    : null;
  const colorOptions = product.colorOptions || [];
  // Adhesive/grout/silicone sync sometimes put colour names into sizeOptions.
  const productSizes = (product.productSizes || []).filter((s) => {
    if (!isSpectraLarsenCategory) return true;
    if (larsenKind === "silicone" || larsenKind === "grout") {
      return !isLarsenColourName(s.name);
    }
    return true;
  });
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
  // Cambridge Skylights imports (see scripts/import-cambridge-skylights.cjs)
  // reuse the `flashings` field to store independent priced add-ons
  // (Structural Glazing Tape, Self-cleaning coating) instead of a single
  // choose-one flashing kit — rendered as checkboxes below, not the dropdown
  // every other product with `flashings` gets.
  const isSkylightImport =
    product.brandSlug === "cambridge-skylights" &&
    product.department === "rooflights-and-glass";
  const [selectedAddonIndices, setSelectedAddonIndices] = useState<
    Set<number>
  >(new Set());
  // Roof pitch is multi-select (a skylight can suit more than one pitch
  // range) — separate from selectedFinishIndex, which stays single-select
  // for every other product's "Finish" picker.
  const [selectedRoofPitchIndices, setSelectedRoofPitchIndices] = useState<
    Set<number>
  >(new Set());
  const [selectedColorIndex, setSelectedColorIndex] = useState<number | null>(
    null,
  );
  const [selectedSizeIndex, setSelectedSizeIndex] = useState<number | null>(
    null,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedFinishIndex(finishes.length ? 0 : null);
    setSelectedFlashingIndex(null);
    setInsulatingSelected(false);
    setSelectedAddonIndices(new Set());
    setSelectedRoofPitchIndices(new Set());
    if (colorOptions.length) {
      const sku = String(product.sku || product.productCode || "").trim();
      const match = colorOptions.findIndex(
        (c) => c.sap && sku && c.sap === sku,
      );
      setSelectedColorIndex(match >= 0 ? match : 0);
    } else {
      setSelectedColorIndex(null);
    }
    setSelectedSizeIndex(productSizes.length ? 0 : null);
  }, [
    product.id,
    finishes.length,
    colorOptions.length,
    productSizes.length,
    product.sku,
    product.productCode,
  ]);

  /**
   * Supplier option axes (e.g. a switch's Type). The selected variant drives
   * the headline price, SKU, image and stock, the way the supplier's PDP does.
   * Under Floor Heating has its own configurator for the same axes.
   */
  const ownsOptionAxes =
    product.brandSlug === "the-under-floor-heating" ||
    /under.?floor.?heating/i.test(String(product.brandName || ""));
  const variantAxes = useMemo(
    () =>
      ownsOptionAxes
        ? []
        : (product.shopifyOptions || []).filter(
            (a) => a?.name && (a.values || []).length > 1,
          ),
    [ownsOptionAxes, product.shopifyOptions],
  );
  const catalogVariants = useMemo(
    () => (ownsOptionAxes ? [] : product.catalogVariants || []),
    [ownsOptionAxes, product.catalogVariants],
  );
  const hasVariantPicker = variantAxes.length > 0 && catalogVariants.length > 1;
  const [variantSelection, setVariantSelection] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    if (!hasVariantPicker) return;
    // Default to the first variant the supplier can actually ship.
    const lead =
      catalogVariants.find((v) => v.available !== false) || catalogVariants[0];
    const next: Record<string, string> = {};
    variantAxes.forEach((axis, i) => {
      const position = Number(axis.position) || i + 1;
      next[axis.name] =
        variantOptionAt(lead, position) || (axis.values || [])[0] || "";
    });
    setVariantSelection(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, hasVariantPicker]);

  const selectedVariant = useMemo(() => {
    if (!hasVariantPicker) return null;
    return (
      catalogVariants.find((v) =>
        variantAxes.every((axis, i) => {
          const want = String(variantSelection[axis.name] || "").toLowerCase();
          if (!want) return true;
          return (
            variantOptionAt(v, Number(axis.position) || i + 1).toLowerCase() ===
            want
          );
        }),
      ) || null
    );
  }, [hasVariantPicker, catalogVariants, variantAxes, variantSelection]);

  const galleryImages = useMemo(() => {
    const base = product.images || [];
    const extras: string[] = [];
    // Hovering a finish swatch previews that finish, as the supplier does.
    if (swatchPreview) extras.push(swatchPreview);
    const variantImg = String(selectedVariant?.imageUrl || "").trim();
    if (variantImg) extras.push(variantImg);
    if (selectedColorIndex != null) {
      const colorImg = String(
        colorOptions[selectedColorIndex]?.imageUrl || "",
      ).trim();
      if (colorImg) extras.push(colorImg);
    }
    if (selectedSizeIndex != null) {
      const sizeImg = String(
        productSizes[selectedSizeIndex]?.imageUrl || "",
      ).trim();
      if (sizeImg) extras.push(sizeImg);
    }
    if (!extras.length) return base;
    const lead = extras[0];
    const rest = [...extras.slice(1), ...base].filter(
      (src, i, arr) => src !== lead && arr.indexOf(src) === i,
    );
    return [lead, ...rest];
  }, [
    product.images,
    colorOptions,
    productSizes,
    selectedColorIndex,
    selectedSizeIndex,
    swatchPreview,
    selectedVariant,
  ]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuantity((q) => Math.min(Math.max(1, q), maxQty));
  }, [product.id, maxQty]);

  /** Price shown and charged: the selected variant's, when there is one. */
  const activePrice =
    Number(selectedVariant?.price) > 0
      ? Number(selectedVariant?.price)
      : product.price;
  const activeCompareAtPrice = selectedVariant
    ? selectedVariant.compareAtPrice ?? null
    : product.compareAtPrice;
  const activeSku = String(selectedVariant?.sku || "") || product.sku;

  const compareAt =
    activeCompareAtPrice != null &&
    Number.isFinite(Number(activeCompareAtPrice)) &&
    Number(activeCompareAtPrice) > Number(activePrice)
      ? Number(activeCompareAtPrice)
      : null;
  // When compare-at is present, `price` is already the live sell price — don't
  // apply salePercent again (that double-discounts Spectra Shopify syncs).
  const onSale =
    !priceOnRequest &&
    (compareAt != null ||
      (typeof product.salePercent === "number" && product.salePercent > 0));
  const salePrice =
    compareAt != null
      ? activePrice
      : saleUnitPrice(activePrice, product.salePercent);
  const baseUnit =
    compareAt != null
      ? activePrice
      : (salePrice ?? activePrice);
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
  const addonsExtra = isSkylightImport
    ? flashings.reduce(
        (sum, addon, index) =>
          selectedAddonIndices.has(index)
            ? sum + (Number(addon.priceAdjustment) || 0)
            : sum,
        0,
      )
    : 0;
  const unitPrice =
    baseUnit + finishExtra + flashingExtra + insulatingExtra + addonsExtra;
  const listPriceForStrike =
    compareAt != null
      ? compareAt + finishExtra + flashingExtra + insulatingExtra + addonsExtra
      : product.price +
        finishExtra +
        flashingExtra +
        insulatingExtra +
        addonsExtra;
  // Prefer the explicitly stored discount percentage (the figure a merchant
  // actually chose) over one derived from the price/compare-at ratio, which
  // can drift from it after rounding — matches ProductCard's precedence.
  const saleBadgePercent =
    typeof product.salePercent === "number" && product.salePercent > 0
      ? Math.round(product.salePercent)
      : compareAt != null
        ? Math.round((1 - product.price / compareAt) * 100)
        : null;
  const isSpectra = product.brandSlug === "spectra";
  const isNatura =
    product.brandSlug === "natura-flooring" ||
    /^natura\b/i.test(String(product.brandName || ""));
  const isDfoBrand =
    product.brandSlug === "direct-flooring-online" ||
    /direct\s*flooring\s*online/i.test(String(product.brandName || ""));
  /** Flooring Sales uses the same pack calculator as Direct Flooring. */
  const isFsl =
    product.brandSlug === "flooring-sales" ||
    /flooring\s*sales/i.test(String(product.brandName || ""));
  const isDfo = isDfoBrand;
  const isOtto =
    product.brandSlug === "otto-tiles" ||
    /^otto\s*tiles/i.test(String(product.brandName || ""));
  const isPooky =
    product.brandSlug === "pooky" ||
    /^pooky\b/i.test(String(product.brandName || ""));
  const isUfhs =
    product.brandSlug === "the-under-floor-heating" ||
    /under.?floor.?heating/i.test(String(product.brandName || ""));
  const ufhsConfig = {
    coverage: product.coverage || null,
    nestedOptions: product.nestedOptions || [],
    doTheJobRight: product.doTheJobRight || null,
    shopifyOptions: product.shopifyOptions || [],
    variants: product.ufhsVariants || [],
  };
  const hasUfhsConfig = isUfhs && hasUfhsConfigurator(ufhsConfig);
  const [ufhsConfigured, setUfhsConfigured] = useState<{
    unitPrice: number;
    variantPrice?: number | null;
    variantPriceIsFrom?: boolean;
    summary: string;
    variantSku?: string;
    variantShopifyId?: string;
    hasAddons?: boolean;
  } | null>(null);
  /**
   * Headline price follows the selected variant (coverage / wattage), matching
   * the supplier PDP. Add-ons are reflected in the kit total below the button,
   * not folded into the headline.
   */
  const ufhsUnitPrice =
    hasUfhsConfig &&
    ufhsConfigured?.variantPrice &&
    ufhsConfigured.variantPrice > 0
      ? ufhsConfigured.variantPrice
      : null;
  /** That price is only a floor — an option axis is still unchosen. */
  const ufhsPriceIsFrom =
    ufhsUnitPrice != null && Boolean(ufhsConfigured?.variantPriceIsFrom);
  /** Full configured total: variant + every selected add-on. */
  const ufhsKitPrice =
    hasUfhsConfig && ufhsConfigured?.unitPrice && ufhsConfigured.unitPrice > 0
      ? ufhsConfigured.unitPrice
      : null;
  const pookyBases = useMemo(
    () => product.bases || [],
    [product.bases],
  );
  const pookyShades = useMemo(
    () => product.shades || [],
    [product.shades],
  );
  const pookyPendants = useMemo(
    () => product.pendants || [],
    [product.pendants],
  );
  const pookyWallFittings = useMemo(
    () => product.wallFittings || [],
    [product.wallFittings],
  );
  const hasPookyConfig =
    isPooky &&
    (hasPookyOptions(pookyBases) ||
      hasPookyOptions(pookyShades) ||
      hasPookyOptions(pookyPendants) ||
      hasPookyOptions(pookyWallFittings));
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
  // Natura Flooring always uses its dedicated m² configurator.
  const deptSlug = String(product.department || "").toLowerCase();
  // Otto Tiles / Direct Flooring Online already offer their own sample flow
  // inside their configurators — everything else in Tiles/Flooring gets the
  // same "request a free sample" enquiry the other suppliers use.
  // Otto Tiles / Direct Flooring Online already offer their own sample flow
  // inside their configurators — everything else in Tiles/Flooring gets the
  // same "request a free sample" enquiry the other suppliers use.
  // department isn't reliably set on every product (many tiles/flooring
  // ranges are filed under unrelated departments), so eligibility rides the
  // same category-keyword check the area calculator uses rather than
  // trusting it.
  const canSample =
    !priceOnRequest &&
    !madeToMeasure &&
    !isOtto &&
    !isDfo &&
    !larsenKind &&
    !hasUfhsConfig &&
    !hasPookyConfig &&
    isAreaSoldCategory(taxonomy);
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
    if (dfoPackCoverage > 0 && dfoPricePerM2 > 0) {
      return Math.round(dfoPricePerM2 * dfoPackCoverage * 100) / 100;
    }
    return 0;
  })();
  const ottoTilesPerBox = parsePositiveNumber(product.tilesPerBox) || 0;
  const ottoTilesPerSqm =
    parsePositiveNumber(product.tilesPerSqm) ||
    deriveTilesPerSqmFromSize(product.size) ||
    0;
  const ottoPricePerM2 = (() => {
    const fromSpec = Number(product.pricePerM2);
    if (Number.isFinite(fromSpec) && fromSpec > 0) return fromSpec;
    // Otto catalogue prices are per m².
    return unitPrice > 0 ? unitPrice : 0;
  })();

  const areaSold =
    !madeToMeasure &&
    !priceOnRequest &&
    !larsenKind &&
    !hasUfhsConfig &&
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
            deptSlug !== "kitchens" &&
            (product.sqmPerBox != null ||
              deptSlug === "tiles" ||
              deptSlug === "flooring" ||
              deptSlug === "outdoor-living" ||
              isAreaSoldCategory(taxonomy)));
  // Direct Flooring and Natura carry explicit per-m² figures. Everything else
  // derives one, and priceIsPerSqm says whether that supplier's price is
  // already per m² or a box price that needs dividing.
  const displayPricePerSqm = isOtto
    ? ottoPricePerM2
    : isDfo
      ? dfoPricePerM2
      : isNatura
        ? naturaPricePerM2
        : pricePerSqmFrom(unitPrice, product.sqmPerBox, product.priceIsPerSqm);
  // Otto/DFO/Natura price per m² is derived from the (already discounted)
  // box price, so the "was" per-m² figure scales by the same was/now ratio
  // rather than being looked up separately.
  const displayWasPricePerSqm =
    onSale && compareAt != null && product.price > 0
      ? Math.round((displayPricePerSqm * (compareAt / product.price)) * 100) /
        100
      : null;

  // Self-serve Trade Mode preview — mirrors (read-only) whichever branch the
  // price row below uses, so it stays correct for Otto/DFO/Natura/UFHS as
  // well as the regular case, without touching that branching logic itself.
  const pdpDisplayedPrice = priceOnRequest
    ? null
    : isNatura || isDfo || isOtto
      ? displayPricePerSqm
      : ufhsUnitPrice != null
        ? ufhsUnitPrice
        : unitPrice;
  const tradeActive =
    mounted &&
    isTradeMode &&
    !priceOnRequest &&
    pdpDisplayedPrice != null &&
    pdpDisplayedPrice > 0;
  const tradePdpPrice = tradeActive
    ? tradeUnitPrice(pdpDisplayedPrice as number, true)
    : null;
  // True original (pre-sale) reference for the "Was" figure — never the
  // intermediate sale price, same rule as ProductCard.
  const pdpOriginalPrice = priceOnRequest
    ? null
    : isNatura || isDfo || isOtto
      ? (displayWasPricePerSqm ?? displayPricePerSqm)
      : ufhsUnitPrice != null
        ? ufhsUnitPrice
        : listPriceForStrike;

  // Scales a calculator's own total (already priced off the sale-adjusted
  // unit rate) up to what the same order would have cost at the true
  // original rate — so a calculator's "Was" matches the true original shown
  // in the main price row above, not just the pre-trade (still sale-priced)
  // total. 1 when there's no sale, so nothing changes for that case.
  const originalMultiplier =
    pdpOriginalPrice != null && pdpDisplayedPrice != null && pdpDisplayedPrice > 0
      ? pdpOriginalPrice / pdpDisplayedPrice
      : 1;

  const [areaOrder, setAreaOrder] = useState<{
    orderAreaM2: number;
    total: number;
    packs?: number;
    requestedM2?: number;
  } | null>(null);
  const [pookyOrder, setPookyOrder] = useState<PookySelection | null>(null);

  const sizeLabel = (() => {
    const raw = product.size?.trim();
    if (!raw || raw.toLowerCase() === "n/a") return null;
    if (
      isSpectraLarsenCategory &&
      (larsenKind === "silicone" || larsenKind === "grout") &&
      isLarsenColourName(raw)
    ) {
      return null;
    }
    return formatDisplaySize(raw) || raw;
  })();

  const sizeOptions = (
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
        : []
  ).filter((option) => {
    if (!isSpectraLarsenCategory) return true;
    if (larsenKind === "silicone" || larsenKind === "grout") {
      return !isLarsenColourName(option.label || option.size);
    }
    return true;
  });

  const specChips = useMemo(() => {
    const chips: { label: string; value: string }[] = [];
    // Type now renders as a badge next to the product name above — don't
    // duplicate it here.
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

    // Underfloor Heating Store configurator (Wattage/Coverage + add-ons).
    if (hasUfhsConfig) {
      const configuredPrice =
        ufhsConfigured?.unitPrice && ufhsConfigured.unitPrice > 0
          ? ufhsConfigured.unitPrice
          : unitPrice;
      const qty = Math.min(Math.max(1, quantity), maxQty);
      let added = 0;
      // A resolved variant with no add-ons is an ordinary stocked SKU — the
      // customer just picked a size and colour. Flagging it made-to-measure
      // sent the whole basket down the site's own checkout at the basket
      // button, which is not where these orders are meant to be taken.
      // Anything with add-ons is priced outside Shopify and stays configured.
      const isPlainVariant = Boolean(
        ufhsConfigured?.variantShopifyId && !ufhsConfigured?.hasAddons,
      );
      for (let i = 0; i < qty; i++) {
        const result = addItem({
          id: isPlainVariant
            ? `${product.id}::${ufhsConfigured?.variantSku || ufhsConfigured?.summary}`
            : `${product.id}::ufhs::${ufhsConfigured?.summary || "base"}`,
          name: product.name,
          price: configuredPrice,
          image: product.images[0] || "",
          category: product.category,
          stock: product.stock,
          productId: product.id,
          shopifyVariantId: isPlainVariant
            ? ufhsConfigured?.variantShopifyId
            : product.shopifyVariantId,
          ...(isPlainVariant ? {} : { isConfigured: true }),
          configurationSummary: ufhsConfigured?.summary || "Configured",
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
      return;
    }

    // Pooky wall fitting / base + shade/pendant combination.
    if (hasPookyConfig) {
      if (!pookyOrder || pookyOrder.total <= 0) {
        toast.error("Select a wall fitting, base and/or shade");
        return;
      }
      const result = addItem({
        id: `${product.id}::pooky::${pookyOrder.wallFittingIndex ?? "x"}-${pookyOrder.baseIndex ?? "x"}-${pookyOrder.shadeTab}-${pookyOrder.shadeIndex ?? "x"}-${pookyOrder.pendantIndex ?? "x"}`,
        name: product.name,
        price: pookyOrder.total,
        image:
          pookyOrder.pendant?.images?.[0] ||
          pookyOrder.shade?.images?.[0] ||
          pookyOrder.wallFitting?.images?.[0] ||
          pookyOrder.base?.images?.[0] ||
          product.images[0] ||
          "",
        category: product.category,
        shopifyVariantId: product.shopifyVariantId,
        isConfigured: true,
        configurationSummary: pookyOrder.summary || "Pooky combination",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Added to cart");
      openCart();
      return;
    }

    // Area-sold products go in as a single configured line priced for the
    // whole area, so the basket matches what the calculator quoted.
    if (areaSold) {
      if (!areaOrder || areaOrder.orderAreaM2 <= 0) {
        toast.error("Enter the area you need");
        return;
      }
      const packs = areaOrder.packs || 0;
      const summary =
        isOtto && packs > 0
          ? `${packs} box${packs === 1 ? "" : "es"} · ${areaOrder.orderAreaM2}m²`
          : isDfo && packs > 0
            ? `${packs} pack${packs === 1 ? "" : "s"} · ${areaOrder.orderAreaM2}m² covered`
            : `${areaOrder.orderAreaM2}m² @ ${formatPrice(displayPricePerSqm)}/m²`;
      const result = addItem({
        id: `${product.id}::${areaOrder.orderAreaM2}m2`,
        name: product.name,
        price: areaOrder.total,
        image: product.images[0] || "",
        category: product.category,
        shopifyVariantId: product.shopifyVariantId,
        isConfigured: true,
        configurationSummary: summary,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isOtto && packs > 0
          ? `${packs} box${packs === 1 ? "" : "es"} (${areaOrder.orderAreaM2}m²) added to cart`
          : isDfo && packs > 0
            ? `${packs} pack${packs === 1 ? "" : "s"} added to cart`
            : `${areaOrder.orderAreaM2}m² added to cart`,
      );
      openCart();
      return;
    }

    const qty = Math.min(quantity, available);
    let added = 0;
    const selectedColor =
      selectedColorIndex != null ? colorOptions[selectedColorIndex] : null;
    // A picked option axis (e.g. Type) makes its own cart line.
    const variantLabel = selectedVariant
      ? variantAxes
          .map(
            (axis, i) =>
              variantOptionAt(selectedVariant, Number(axis.position) || i + 1),
          )
          .filter(Boolean)
          .join(" / ")
      : "";
    const cartName = selectedColor?.name
      ? `${product.name} — ${selectedColor.name}`
      : variantLabel
        ? `${product.name} — ${variantLabel}`
        : product.name;
    const cartImage =
      selectedColor?.imageUrl ||
      selectedVariant?.imageUrl ||
      product.images[0] ||
      "";
    for (let i = 0; i < qty; i++) {
      const result = addItem({
        id: selectedColor?.sap
          ? `${product.id}::${selectedColor.sap}`
          : variantLabel
            ? `${product.id}::${selectedVariant?.sku || variantLabel}`
            : product.id,
        name: cartName,
        price: unitPrice,
        image: cartImage,
        category: product.category,
        stock: product.stock,
        // The real product, kept apart from the composite cart-line key above.
        productId: product.id,
        // A chosen variant is charged at its own Shopify variant, never the
        // product-level one — that would bill every size at the first size's
        // price. An unsynced variant deliberately carries nothing, so checkout
        // fails loudly instead of overcharging.
        shopifyVariantId: variantLabel
          ? (selectedVariant?.shopifyVariantId ?? null)
          : product.shopifyVariantId,
        // A colour is a supplier finish list, not a stocked variant row: it has
        // no SKU of its own to sell, so it stays a configured line. A variant
        // pick is an ordinary stocked SKU and keeps its stock and its Shopify
        // route — marking it configured is what sent it to the site's own
        // checkout, so only the summary label is carried for it.
        ...(selectedColor?.name
          ? {
              isConfigured: true,
              configurationSummary: `Colour: ${selectedColor.name}`,
            }
          : variantLabel
            ? {
                configurationSummary: variantAxes
                  .map(
                    (axis, i) =>
                      `${axis.name}: ${variantOptionAt(
                        selectedVariant as CatalogVariant,
                        Number(axis.position) || i + 1,
                      )}`,
                  )
                  .filter(Boolean)
                  .join(" · "),
              }
            : {}),
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
          ? `${cartName} added to your cart`
          : `${added} × ${cartName} added to your cart`,
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
        // The catalogue/box price (product.price) doesn't match what's shown
        // on the page for area-sold ranges (Otto/DFO/Natura quote per m²) or
        // anything on sale — use the same figure the buy box displays so the
        // wishlist (and its own trade-price preview) shows the right number.
        // Falls back to unitPrice (always sale-adjusted, never the raw
        // catalogue/box figure) rather than product.price if that figure
        // isn't available for some reason.
        price:
          pdpDisplayedPrice != null && pdpDisplayedPrice > 0
            ? pdpDisplayedPrice
            : unitPrice,
        image: product.images[0] || "",
        category: product.category,
      });
      await addToDb(product.id);
      toast.success(`${product.name} added to your wishlist`);
      openWishlist();
    }
  };

  const brandLabel = storefrontBrandLabel(product.brandName);
  const categoryLabel = product.categoryName || product.category;
  const typeLabel = product.subCategoryName || product.subCategory || null;

  return (
    <div className="min-w-0">
      <nav className="flex flex-wrap items-center gap-1.5 text-[12px] sm:text-sm text-foreground/50 mb-6 sm:mb-8">
        <Link href="/" className="hover:text-foreground transition-colors shrink-0">
          Home
        </Link>
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        <Link
          href={
            product.brandSlug
              ? `/category?brand=${encodeURIComponent(product.brandSlug)}`
              : "/category"
          }
          className="hover:text-foreground transition-colors shrink-0"
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
              className="hover:text-foreground transition-colors shrink-0"
            >
              {categoryLabel}
            </Link>
          </>
        ) : null}
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 flex-1 basis-full sm:basis-auto wrap-break-word text-foreground font-medium">
          {product.name}
        </span>
      </nav>

      <div className="grid md:grid-cols-2 gap-8 md:gap-10 lg:gap-14">
        <div className="md:sticky md:top-28 lg:top-32 md:self-start min-w-0">
          <ProductGallery
            images={galleryImages}
            name={product.name}
            darkModeImage={product.darkModeImage || ""}
            cornerBadge={
              tradeActive
                ? onSale && saleBadgePercent
                  ? `${saleBadgePercent}% + ${TRADE_DISCOUNT_PERCENT}% (Trade) OFF`
                  : `${TRADE_DISCOUNT_PERCENT}% (Trade) OFF`
                : onSale
                  ? saleBadgePercent
                    ? `${saleBadgePercent}% OFF`
                    : "SALE"
                  : null
            }
            showSampleBadge={!priceOnRequest && areaSold && !product.hasPaidSample}
          />
          <ProductTrustStrip />
          <ProductAddOns
            heading={product.addOnsHeading || "Add-ons for this product"}
            items={product.addOns}
          />
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
                {typeLabel ? (
                  <span className="ml-2 inline-flex align-middle items-center rounded-full border border-foreground/15 bg-foreground/5 px-2 py-0.5 text-[11px] font-sans font-semibold uppercase tracking-wide text-foreground/55">
                    {typeLabel}
                  </span>
                ) : null}
              </h1>
              <ShareButton />
            </div>

            <ProductRatingSummary
              averageRating={product.averageRating ?? 0}
              reviewCount={product.reviewCount ?? 0}
              onClickReviews={openProductReviewsTab}
              className="mt-3"
            />

            {colorOptions.length ? (
              <ProductColorSwatches
                colors={colorOptions}
                selectedIndex={selectedColorIndex}
                onSelect={setSelectedColorIndex}
                className="mt-4"
              />
            ) : null}

            {productSizes.length ? (
              <ProductSizeSwatches
                sizes={productSizes}
                selectedIndex={selectedSizeIndex}
                onSelect={setSelectedSizeIndex}
                className="mt-4"
              />
            ) : null}

            {(activeSku || product.productCode) && (
              <p className="mt-2 text-sm text-foreground/50 break-all">
                {product.productCode && activeSku
                  ? `SKU: ${product.productCode} · ${activeSku}`
                  : `SKU: ${product.productCode || activeSku}`}
              </p>
            )}
          </div>

          <div className="flex items-baseline gap-2 flex-wrap">
            {tradeActive &&
            pdpOriginalPrice != null &&
            tradePdpPrice != null &&
            pdpOriginalPrice > 0 ? (
              (() => {
                // Badge shows the simple sum of the sale % and the trade %
                // (not the compounded figure — the actual was/now prices
                // above stay mathematically exact either way).
                const combinedPercent =
                  (onSale && saleBadgePercent != null && saleBadgePercent > 0
                    ? saleBadgePercent
                    : 0) + TRADE_DISCOUNT_PERCENT;
                return combinedPercent > 0 ? (
                  <span className="rounded-md bg-[#D3102F] text-white text-[10px] font-bold px-2 py-0.5 shadow-sm">
                    {combinedPercent}% off
                  </span>
                ) : null;
              })()
            ) : onSale && saleBadgePercent != null && saleBadgePercent > 0 ? (
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
              ) : isNatura || isDfo || isOtto ? (
                displayWasPricePerSqm != null ? (
                  <>
                    <span className="text-xl md:text-2xl font-medium text-foreground/45 line-through mr-2">
                      {formatPrice(displayWasPricePerSqm)}
                    </span>
                    {formatPrice(displayPricePerSqm)}
                  </>
                ) : (
                  formatPrice(displayPricePerSqm)
                )
              ) : ufhsUnitPrice != null ? (
                ufhsPriceIsFrom ? (
                  <>
                    <span className="text-base md:text-lg font-medium text-foreground/55 mr-2">
                      From
                    </span>
                    {formatPrice(ufhsUnitPrice)}
                  </>
                ) : (
                  formatPrice(ufhsUnitPrice)
                )
              ) : pdpOriginalPrice != null &&
                pdpDisplayedPrice != null &&
                (pdpOriginalPrice > pdpDisplayedPrice || tradeActive) ? (
                <>
                  <span className="text-xl md:text-2xl font-medium text-foreground/45 line-through mr-2">
                    Was {formatPrice(pdpOriginalPrice)}
                  </span>
                  {formatPrice(
                    tradeActive && tradePdpPrice != null
                      ? tradePdpPrice
                      : pdpDisplayedPrice,
                  )}
                </>
              ) : (
                formatPrice(pdpDisplayedPrice as number)
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
                : isNatura || isDfo || isOtto
                  ? "Per M2"
                  : isSpectra && larsenKind
                  ? larsenKind === "silicone"
                    ? "per cartridge · inc. VAT"
                    : larsenKind === "grout"
                      ? "per pack · inc. VAT"
                      : "per bag · inc. VAT"
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

          {(product.swatchGroups || []).length ? (
            <ProductFinishSwatches
              groups={product.swatchGroups || []}
              onPreview={setSwatchPreview}
            />
          ) : null}

          {hasVariantPicker ? (
            <ProductVariantPicker
              axes={variantAxes}
              variants={catalogVariants}
              selection={variantSelection}
              onSelect={(axis, value) =>
                setVariantSelection((prev) => ({ ...prev, [axis]: value }))
              }
            />
          ) : null}

          {/* Instalment line directly under the price, where a shopper is
              deciding whether they can afford it. */}
          {!priceOnRequest ? (
            <KlarnaInstalmentNote price={unitPrice} />
          ) : null}

          {specChips.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {specChips.map((chip) => (
                <div
                  key={chip.label}
                  className="inline-flex flex-col rounded-lg border border-foreground/10 bg-[#faf8f3] px-3 py-2 min-w-0 flex-1 basis-[calc(50%-0.25rem)] sm:flex-none sm:min-w-28"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/45">
                    {chip.label}
                  </span>
                  <span className="text-sm font-semibold text-foreground mt-0.5 wrap-break-word">
                    {chip.value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {priceOnRequest || outOfStock ? (
            <p
              className={cn(
                "text-sm font-medium",
                priceOnRequest ? "text-foreground/70" : "text-destructive",
              )}
            >
              {priceOnRequest
                ? "Price on request — contact us for availability and a quote"
                : cartQty > 0
                  ? "All available units are in your cart"
                  : "Out of stock"}
            </p>
          ) : null}

          {/* Sibling-product sizes (Spectra). Skip when this product has
              admin sizeOptions with images, or Otto's own configurator. */}
          {!isOtto && !productSizes.length && sizeOptions.length > 0 ? (
            <div className="rounded-xl border border-foreground/10 bg-white p-4 sm:p-5 space-y-3">
              <p className="text-sm font-bold uppercase tracking-wide text-foreground">
                Size
              </p>
              <select
                value={
                  sizeOptions.find((option) => option.isCurrent)?.id ||
                  product.id
                }
                onChange={(e) => {
                  const id = e.target.value;
                  if (id === product.id) return;
                  router.push(`/products/${id}`);
                }}
                aria-label="Size"
                className="w-full rounded-lg border border-foreground/15 bg-[#faf8f3] px-3.5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-foreground/40 focus:outline-none focus:border-foreground"
              >
                {sizeOptions.map((option) => {
                  const label = option.label || formatDisplaySize(option.size);
                  const showPrice =
                    !priceOnRequest &&
                    Number.isFinite(option.price) &&
                    option.price > 0;
                  return (
                    <option
                      key={`${option.id}-${option.size}`}
                      value={option.id}
                    >
                      {label}
                      {showPrice ? ` — ${formatPrice(option.price)}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : null}

          {isSkylightImport ? (
            <div className="space-y-2">
              <RoofPitchPicker
                options={finishes}
                selected={selectedRoofPitchIndices}
                onToggle={(index) =>
                  setSelectedRoofPitchIndices((prev) => {
                    const next = new Set(prev);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
              />
              <ProductAddonCheckboxList
                addons={flashings}
                selected={selectedAddonIndices}
                onToggle={(index) =>
                  setSelectedAddonIndices((prev) => {
                    const next = new Set(prev);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
              />
            </div>
          ) : (
            <>
              <ProductFinishPicker
                finishes={finishes}
                selectedIndex={selectedFinishIndex}
                onSelect={setSelectedFinishIndex}
              />
              <ProductFlashingPicker
                flashings={flashings}
                selectedIndex={selectedFlashingIndex}
                onSelect={setSelectedFlashingIndex}
              />
            </>
          )}

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

          {/* Pooky: wall fitting + base + shade/pendant selectors. */}
          {isPooky && (hasPookyConfig || product.efficiency) ? (
            <PookyConfigurator
              bases={pookyBases}
              shades={pookyShades}
              pendants={pookyPendants}
              wallFittings={pookyWallFittings}
              efficiency={product.efficiency}
              productType={product.productType || undefined}
              disabled={outOfStock && !priceOnRequest}
              onChange={setPookyOrder}
              onAddToBasket={handleAddToCart}
            />
          ) : null}

          {/* Otto Tiles: sample/size + m²/overage/boxes (ottotiles.co.uk). */}
          {!priceOnRequest && areaSold && isOtto ? (
            <OttoTilesConfigurator
              pricePerM2={ottoPricePerM2}
              samplePrice={
                Number(product.samplePrice) > 0
                  ? Number(product.samplePrice)
                  : 7
              }
              tilesPerBox={ottoTilesPerBox}
              tilesPerSqm={ottoTilesPerSqm}
              sizeLabel={
                sizeLabel ||
                String(product.size || "").trim() ||
                "Full size"
              }
              swatchImage={product.images[0] || ""}
              productId={product.id}
              productName={product.name}
              brandName={product.brandName}
              sku={product.sku || product.productCode}
              category={product.category}
              categoryName={product.categoryName}
              leadTimeLabel={product.leadTimeLabel || undefined}
              leadTimeDetail={product.leadTimeDetail || undefined}
              disabled={outOfStock}
              onQuantityChange={setAreaOrder}
              onAddToBasket={handleAddToCart}
              tradeActive={tradeActive}
              originalMultiplier={originalMultiplier}
            />
          ) : null}

          {/* Natura Flooring: simple m² configurator (naturaflooring.co.uk style). */}
          {!priceOnRequest && areaSold && isNatura ? (
            <NaturaAreaConfigurator
              pricePerM2={displayPricePerSqm}
              packCoverageM2={Number(product.sqmPerBox) || null}
              disabled={outOfStock}
              onQuantityChange={setAreaOrder}
              tradeActive={tradeActive}
              originalMultiplier={originalMultiplier}
            />
          ) : null}

          {/* Direct Flooring Online: pack/m² calculator (directflooringonline.co.uk). */}
          {!priceOnRequest && areaSold && isDfo ? (
            <DirectFlooringConfigurator
              addonGroups={product.addonGroups || []}
              pricePerPack={dfoPricePerPack}
              packCoverageM2={dfoPackCoverage}
              pricePerM2={dfoPricePerM2}
              productId={product.id}
              productName={product.name}
              brandName={product.brandName}
              sku={product.sku || product.productCode}
              category={product.category}
              categoryName={product.categoryName}
              disabled={outOfStock}
              onQuantityChange={setAreaOrder}
              onAddToBasket={handleAddToCart}
              tradeActive={tradeActive}
              originalMultiplier={originalMultiplier}
            />
          ) : null}

          {/* Spectra Adhesive / Grout / Silicone: Larsen calculator + guide. */}
          {!priceOnRequest && larsenKind ? (
            <SpectraLarsenConfigurator
              kind={larsenKind}
              productName={product.name}
              quantity={quantity}
              maxQuantity={maxQty}
              disabled={outOfStock}
              onQuantityChange={setQuantity}
            />
          ) : null}

          {/* Flooring Sales: their own measurement price calculator. */}
          {!priceOnRequest && isFsl && dfoPricePerPack > 0 ? (
            <FlooringSalesConfigurator
              addonGroups={product.addonGroups || []}
              pricePerPack={dfoPricePerPack}
              packCoverageM2={dfoPackCoverage}
              stockLabel={product.stockAvailabilityText || ""}
              disabled={outOfStock}
              onChange={({ packs, coveredM2, total }) => {
                setQuantity(Math.max(1, packs));
                setAreaOrder(
                  packs > 0
                    ? { orderAreaM2: coveredM2, total, packs }
                    : null,
                );
              }}
            />
          ) : null}

          {/* Underfloor Heating Store: promo strip above the buy box. */}
          {product.promoBanner?.image ? (
            <img
              src={product.promoBanner.image}
              alt={product.promoBanner.alt || product.name}
              className="w-full rounded-xl border border-foreground/10"
              loading="lazy"
            />
          ) : null}

          {/* Underfloor Heating Store: Wattage/Coverage + nested options + tools. */}
          {!priceOnRequest && hasUfhsConfig ? (
            <UfhsConfigurator
              basePrice={unitPrice}
              shopifyOptions={ufhsConfig.shopifyOptions}
              variants={ufhsConfig.variants}
              coverage={ufhsConfig.coverage}
              nestedOptions={ufhsConfig.nestedOptions}
              doTheJobRight={ufhsConfig.doTheJobRight}
              optionInfo={product.optionInfo || []}
              optionElements={product.optionElements || []}
              hasMeasureMyRoom={product.hasMeasureMyRoom}
              productName={product.name}
              quantity={quantity}
              maxQuantity={maxQty}
              disabled={outOfStock}
              onQuantityChange={setQuantity}
              onConfiguredChange={setUfhsConfigured}
              tradeActive={tradeActive}
              originalMultiplier={originalMultiplier}
            />
          ) : null}

          {/* Other area-sold tiles/flooring get the project calculator. */}
          {!priceOnRequest &&
          areaSold &&
          !isNatura &&
          !isDfo &&
          !isFsl &&
          !isOtto &&
          !larsenKind ? (
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
              tradeActive={tradeActive}
              originalMultiplier={originalMultiplier}
            />
          ) : null}

          {!madeToMeasure &&
          !((isDfo || isOtto) && areaSold) &&
          !hasPookyConfig ? (
          <div className="rounded-xl border border-foreground/10 bg-white p-5 space-y-4">
            {!priceOnRequest && !areaSold && !larsenKind && !hasUfhsConfig ? (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-semibold text-foreground">
                  Quantity
                </span>
                <div className="flex items-center border border-foreground/45 rounded-lg">
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
              className="w-full h-12 inline-flex items-center justify-center gap-2 text-base font-bold bg-foreground text-background hover:bg-foreground/90 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-foreground disabled:hover:opacity-40"
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
                    ? `Add to Cart · ${formatPrice(
                        tradeActive
                          ? tradeUnitPrice(areaOrder.total, true)
                          : areaOrder.total,
                      )}`
                    : hasUfhsConfig && ufhsConfigured?.unitPrice
                      ? `Add to Cart · ${formatPrice(
                          tradeActive
                            ? tradeUnitPrice(
                                ufhsConfigured.unitPrice * quantity,
                                true,
                              )
                            : ufhsConfigured.unitPrice * quantity,
                        )}`
                      : "Add to Cart"}
            </button>

            {/* Running kit total, as shown under the supplier's Add to cart. */}
            {ufhsKitPrice != null ? (
              <div
                className="flex items-baseline justify-end gap-2.5 w-full"
                aria-live="polite"
              >
                <span className="text-sm text-foreground/60">
                  The price for your kit is
                </span>
                {tradeActive ? (
                  <span className="text-sm font-medium text-foreground/45 line-through">
                    Was{" "}
                    {formatPrice(
                      ufhsKitPrice * quantity * originalMultiplier,
                    )}
                  </span>
                ) : null}
                <span className="text-xl font-bold text-foreground">
                  {formatPrice(
                    tradeActive
                      ? tradeUnitPrice(ufhsKitPrice * quantity, true)
                      : ufhsKitPrice * quantity,
                  )}
                </span>
              </div>
            ) : null}

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

            {canSample ? (
              <Link
                href={buildSampleRequestHref({
                  id: product.id,
                  name: product.name,
                  sku: product.sku,
                  productCode: product.productCode,
                  brandName: product.brandName,
                  category: product.category,
                  categoryName: product.categoryName,
                })}
                className="w-full h-11 inline-flex items-center justify-center gap-2 text-sm font-semibold border border-foreground/15 rounded-xl hover:bg-secondary transition-colors"
              >
                <Mail className="w-4 h-4" />
                Request a free sample
              </Link>
            ) : null}
          </div>
          ) : null}

          {/* Otto Tiles / Direct Flooring Online render their own area
              calculator above in place of the standard buy box, and neither
              configurator has a wishlist control of its own — this fallback
              keeps Add to Wishlist visible for both. */}
          {!madeToMeasure && (isDfo || isOtto) && areaSold ? (
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
          ) : null}

          {/* Only renders methods listed in NEXT_PUBLIC_PAYMENT_METHODS. */}
          <PaymentMethodTags className="pt-1" />

          {support ? (
            <ProductSupportPanel
              phone={support.phone}
              phoneHref={support.phoneHref}
              email={support.email}
              hours={support.hours}
              productName={product.name}
              productCode={product.productCode || product.sku}
            />
          ) : null}

          {/* Supplier accordions sit directly under the help panel. */}
          <ProductSupplierSections
            sections={product.supplierSections}
            infoDropdowns={product.infoDropdowns}
          />

          <ProductFeaturePacking
            features={product.featureEntries}
            packing={product.packingEntries}
            legalDisclaimer={product.legalDisclaimer}
          />

          {/* Separate accordion — not mixed with Downloads. */}
          <ProductFilesDocumentation
            sections={product.filesDocumentation}
          />

          {/* Separate accordion — not mixed with Files and Documentation. */}
          <ProductDownloads downloads={product.downloads} />

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

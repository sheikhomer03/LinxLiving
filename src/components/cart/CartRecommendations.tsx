"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Package, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/store/useCartStore";
import { getProductsByCategory } from "@/app/actions/products";
import { isAreaSoldCategory, pricePerSqmFrom } from "@/lib/tileCalculator";
import { resolveStorefrontUnitPrice } from "@/lib/naturaPrice";
import {
  RecommendationConfigurator,
  type ConfigurableProduct,
} from "@/components/cart/RecommendationConfigurator";

interface RecommendedProduct {
  _id: string;
  name: string;
  price: number;
  images?: string[];
  category?: string;
  subCategory?: string;
  /** Needed to tell an area-sold range from a unit-sold one. */
  department?: string;
  brand?: { name?: string; slug?: string } | null;
  specs?: Record<string, unknown> | null;
  stock?: number;
  shopifyVariantId?: string | null;
}

/**
 * Ranges whose price depends on choices this list cannot make — they open
 * the product page rather than a generic area box.
 */
const BESPOKE_CONFIGURATOR_BRANDS = new Set([
  "pooky",
  "otto-tiles",
  "the-under-floor-heating",
  "ukbifolddoorfactory",
]);

const MAX_RECOMMENDATIONS = 6;
const PER_CATEGORY_LIMIT = 12;

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
}

/** Configured cart lines use composite ids like "<productId>::pooky::...". */
function baseProductId(id: string) {
  return id.includes("::") ? id.split("::")[0] : id;
}

function RecommendedRow({ product }: { product: RecommendedProduct }) {
  const addItem = useCartStore((s) => s.addItem);
  const [configuring, setConfiguring] = useState(false);
  const cartQty = useCartStore((s) => s.getCartQuantity(product._id));
  const available = Math.max(0, (product.stock ?? 0) - cartQty);
  const outOfStock = typeof product.stock === "number" && available <= 0;
  const image = product.images?.[0] || "";
  // `department` is what identifies an area-sold range; without it tiles
  // showed a pack price with no unit.
  const perSqm = isAreaSoldCategory({
    department: product.department,
    category: product.category,
    subCategory: product.subCategory,
  });

  // Same resolver the product cards use, so the rate shown here matches the
  // rest of the site rather than being the raw pack price.
  const resolved = resolveStorefrontUnitPrice({
    price: product.price,
    brandSlug: product.brand?.slug,
    brandName: product.brand?.name,
    specs: product.specs || undefined,
  });
  const packCoverage = Number(
    (product.specs as { sqmPerBox?: unknown } | null)?.sqmPerBox ?? 0,
  );
  const unitPrice = resolved.perSqm
    ? resolved.price
    : perSqm
      ? pricePerSqmFrom(product.price, packCoverage || null)
      : product.price;
  const showPerSqm = resolved.perSqm || perSqm;
  const needsConfig = showPerSqm;
  const needsProductPage = BESPOKE_CONFIGURATOR_BRANDS.has(
    String(product.brand?.slug || "").toLowerCase(),
  );

  const handleAdd = () => {
    if (outOfStock) {
      toast.error("This product is out of stock");
      return;
    }
    // A tile or a floor cannot be added as "1" — ask for the area first.
    if (needsConfig || needsProductPage) {
      setConfiguring(true);
      return;
    }
    const result = addItem({
      id: product._id,
      name: product.name,
      price: product.price,
      image,
      category: product.category || "",
      stock: product.stock,
      shopifyVariantId: product.shopifyVariantId || undefined,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${product.name} added to your cart`);
  };

  return (
    <li className="flex gap-4 p-5">
      <Link
        href={`/products/${product._id}`}
        className="relative w-20 h-24 bg-secondary shrink-0 overflow-hidden flex items-center justify-center"
      >
        {image ? (
          <Image src={image} alt={product.name} fill className="object-cover" />
        ) : (
          <Package className="w-6 h-6 text-foreground/20" />
        )}
      </Link>

      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div className="space-y-1">
          <Link
            href={`/products/${product._id}`}
            className="block text-[11px] uppercase tracking-wide font-bold line-clamp-2 hover:text-primary transition-colors"
          >
            {product.name}
          </Link>
          {product.category ? (
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {product.category}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 mt-3">
          <p className="text-sm font-semibold text-primary tabular-nums">
            {formatPrice(unitPrice)}
            {showPerSqm ? (
              <span className="text-xs align-top">/m²</span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={handleAdd}
            disabled={outOfStock}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 h-8 px-3 text-[10px] font-bold uppercase tracking-wide bg-foreground text-background hover:bg-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {outOfStock ? (
              "Out of Stock"
            ) : (
              <>
                <Plus className="w-3 h-3" />
                {needsConfig || needsProductPage ? "Choose" : "Add"}
              </>
            )}
          </button>
        </div>
      </div>

      {configuring ? (
        <RecommendationConfigurator
          product={
            {
              _id: product._id,
              name: product.name,
              unitPrice,
              perSqm: showPerSqm,
              packCoverageM2: packCoverage || null,
              image,
              category: product.category,
              stock: product.stock,
              shopifyVariantId: product.shopifyVariantId,
              needsProductPage,
            } satisfies ConfigurableProduct
          }
          onClose={() => setConfiguring(false)}
        />
      ) : null}
    </li>
  );
}

/**
 * Category-matched upsell shown inside the cart drawer. Only ever pulls from
 * categories already represented in the cart — never a category the shopper
 * hasn't shown interest in.
 */
export function CartRecommendations() {
  const items = useCartStore((s) => s.items);
  const [recommended, setRecommended] = useState<RecommendedProduct[]>([]);

  const categories = Array.from(
    new Set(items.map((i) => String(i.category || "").trim()).filter(Boolean)),
  ).sort();
  const categoriesKey = categories.join("|");
  const cartIdsKey = Array.from(
    new Set(items.map((i) => baseProductId(i.id))),
  )
    .sort()
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const cartIds = new Set(cartIdsKey ? cartIdsKey.split("|") : []);
    const cats = categoriesKey ? categoriesKey.split("|") : [];

    if (cats.length === 0) {
      setRecommended([]);
      return;
    }

    async function load() {
      try {
        const results = await Promise.all(
          cats.map((c) => getProductsByCategory(c, PER_CATEGORY_LIMIT)),
        );
        if (cancelled) return;

        const seen = new Set<string>();
        const merged: RecommendedProduct[] = [];
        const maxLen = Math.max(0, ...results.map((r) => r.length));

        // Round-robin across categories so a mixed cart gets a mixed set
        // rather than one category dominating.
        for (let i = 0; i < maxLen && merged.length < MAX_RECOMMENDATIONS; i++) {
          for (const list of results) {
            const product = list[i] as RecommendedProduct | undefined;
            if (!product) continue;
            const id = String(product._id);
            if (seen.has(id) || cartIds.has(id)) continue;
            seen.add(id);
            merged.push(product);
            if (merged.length >= MAX_RECOMMENDATIONS) break;
          }
        }

        setRecommended(merged);
      } catch {
        if (!cancelled) setRecommended([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [categoriesKey, cartIdsKey]);

  if (recommended.length === 0) return null;

  return (
    <div className="border-t border-foreground/8 bg-secondary/40 py-4">
      <h3 className="flex items-center gap-1.5 px-5 text-[11px] uppercase tracking-[0.22em] font-bold text-foreground">
        <Sparkles className="w-3.5 h-3.5 text-primary" strokeWidth={2} />
        You might also like
      </h3>
      <ul className="mt-2 divide-y divide-foreground/8">
        {recommended.map((product) => (
          <RecommendedRow key={product._id} product={product} />
        ))}
      </ul>
    </div>
  );
}

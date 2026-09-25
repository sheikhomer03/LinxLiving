import type { ProductSizeOption } from "@/lib/moreFromProducts";
import { formatDisplaySize } from "@/lib/sizeBuckets";

/**
 * Cross-product colour/size siblings for brands where each colourway/size
 * is its OWN separate product document (Walls and Floors, and any future
 * brand scraped the same way) rather than a same-document variant array.
 *
 * `product.specs.variantSiblings` is written once at import time by a
 * brand's sibling-linking pass (see scripts/capture-wallsandfloors-siblings.cjs
 * + the DB-linking script) — a denormalised snapshot of every other
 * product in the same range, keyed by this brand's own verified `Product
 * color` / `Size` spec values. Deliberately NOT the generic
 * `pickSizeOptions` mechanism (moreFromProducts.ts), which only searches
 * the nearest 40 same-category products sorted by price and silently
 * misses a real sibling once a category holds hundreds of products.
 */
export type VariantSibling = {
  id: string;
  name: string;
  colour?: string;
  size?: string;
  /** Friendly size label from the source site ("XXL Panel" / "Half
   *  Panel") where one exists — preferred over the raw-mm-converted
   *  fallback formatDisplaySize would otherwise produce ("260 × 90"),
   *  which loses the source's own naming for ranges that size by
   *  descriptive tier rather than plain dimensions. */
  sizeLabel?: string;
  price: number;
  image?: string;
};

export type VariantColorOption = {
  id: string;
  name: string;
  image?: string;
  price: number;
  isCurrent: boolean;
};

function asSiblings(raw: unknown): VariantSibling[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is VariantSibling => !!r && typeof r === "object" && typeof (r as VariantSibling).id === "string")
    .map((r) => ({
      id: String(r.id),
      name: String(r.name || ""),
      colour: r.colour ? String(r.colour) : undefined,
      size: r.size ? String(r.size) : undefined,
      sizeLabel: r.sizeLabel ? String(r.sizeLabel) : undefined,
      price: Number(r.price) || 0,
      image: r.image ? String(r.image) : undefined,
    }));
}

function significantWords(name: string, colour: string): string[] {
  const colourWords = new Set(
    colour.toLowerCase().replace(/[^a-z]+/g, " ").split(" ").filter(Boolean),
  );
  return name
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*x\s*\d+(\.\d+)?\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !colourWords.has(w));
}

/**
 * One swatch per distinct colour+pattern among this product + its
 * siblings — the current entry always included first, image sourced from
 * that specific colourway's own hero photo (never the current product's).
 *
 * Deduping by raw colour VALUE alone silently collapsed real choices:
 * a "Decor" pattern variant can share the exact same `Product color`
 * value as its plain counterpart (Seville Grey vs. Seville Grey Decor —
 * both stored as colour="Grey"), so the live site's 4 real swatches
 * (Grey, Grey - Decor, Cream, Cream - Decor) came out as just 2. Instead,
 * label + dedupe by colour PLUS whatever extra word(s) this specific
 * product's name carries beyond the group's shared base name (computed
 * across the whole current+siblings set, not per-item) — "Decor" survives
 * as a distinguishing suffix instead of being silently discarded.
 */
export function pickVariantColorOptions(
  current: { id: string; name: string; colour?: string; price: number; image?: string },
  variantSiblingsRaw: unknown,
): VariantColorOption[] {
  const currentColour = String(current.colour || "").trim();
  if (!currentColour) return [];

  const group = [
    { id: current.id, name: current.name, colour: currentColour, price: current.price, image: current.image, isCurrent: true },
    ...asSiblings(variantSiblingsRaw)
      .filter((s) => String(s.colour || "").trim())
      .map((s) => ({ id: s.id, name: s.name, colour: String(s.colour).trim(), price: s.price, image: s.image, isCurrent: false })),
  ];

  const wordSets = group.map((g) => significantWords(g.name, g.colour));
  const commonBase = wordSets.reduce(
    (acc, words) => new Set([...acc].filter((w) => words.includes(w))),
    new Set(wordSets[0] || []),
  );

  const byKey = new Map<string, VariantColorOption>();
  for (let i = 0; i < group.length; i++) {
    const g = group[i];
    const extra = wordSets[i].filter((w) => !commonBase.has(w));
    const label = extra.length
      ? `${g.colour} - ${extra.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}`
      : g.colour;
    const key = g.colour.toLowerCase() + "|" + extra.join(" ");
    if (byKey.has(key)) {
      if (g.isCurrent) byKey.set(key, { ...byKey.get(key)!, id: g.id, isCurrent: true });
      continue;
    }
    byKey.set(key, { id: g.id, name: label, image: g.image, price: g.price, isCurrent: g.isCurrent });
  }

  const out = [...byKey.values()];
  // Only worth showing as a swatch picker when there's an actual choice.
  return out.length > 1 ? out : [];
}

/**
 * Size siblings in the SAME shape the existing Spectra-style size <select>
 * already renders (ProductSection.tsx) — merged in there alongside
 * whatever the generic `pickSizeOptions` found, so the current dropdown
 * UI works unchanged, just fed a complete list instead of a possibly
 * truncated one.
 */
export function pickVariantSizeOptions(
  current: { id: string; size?: string; price: number; sizeLabel?: string },
  variantSiblingsRaw: unknown,
): ProductSizeOption[] {
  const currentSize = String(current.size || "").trim();
  if (!currentSize) return [];

  const bySize = new Map<string, ProductSizeOption>();
  bySize.set(currentSize.toLowerCase(), {
    id: current.id,
    size: currentSize,
    label: current.sizeLabel?.trim() || formatDisplaySize(currentSize),
    price: current.price,
    isCurrent: true,
  });

  for (const sib of asSiblings(variantSiblingsRaw)) {
    const size = String(sib.size || "").trim();
    if (!size) continue;
    const key = size.toLowerCase();
    if (bySize.has(key)) continue;
    bySize.set(key, {
      id: sib.id,
      size,
      label: sib.sizeLabel?.trim() || formatDisplaySize(size),
      price: sib.price,
      isCurrent: false,
    });
  }

  return [...bySize.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
}

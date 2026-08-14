/**
 * Server-side price authority for made-to-measure ("configured") cart lines.
 *
 * A configured line has no Shopify variant, so its price is worked out by a
 * configurator in the browser and sent up with the basket. That number is now
 * what Shopify actually charges (draft-order custom line), so it can no longer
 * be taken on trust.
 *
 * What this does NOT do is re-run every configurator. Five of them price
 * differently (pack rounding, add-on kits, component sums, size interpolation,
 * finish upcharges) and a server formula that drifted by a penny from the
 * browser's would reject honest baskets at the till. Instead it establishes a
 * FLOOR: the least a line could legitimately cost, derived from the product in
 * Mongo and the quantity the customer says they are receiving. Anything at or
 * above the floor is charged as quoted; anything below it is refused.
 *
 * The floor holds because every configurator only ever adds to the base rate —
 * area multiplies it, add-ons/finishes/components increase it. Nothing takes a
 * line below (lowest listed rate x quantity), once the largest standing
 * discount is allowed for.
 *
 * The selectors this reads (area, packs, option indices, SKU) are the same ones
 * recorded on the order, so understating them to reach a lower floor also
 * understates what gets delivered.
 */

import { resolveStorefrontUnitPrice } from "./naturaPrice";
import { TRADE_DISCOUNT_PERCENT } from "./trade";

/** Selections sent with a configured line. Never a rate — only quantities. */
export type ConfiguredSelection = {
  kind?: "area" | "pooky" | "ufhs" | "size" | "colour" | null;
  quantity: number;
  /** Unit price the browser quoted, ex-VAT. */
  claimedUnitPrice: number;
  areaM2?: number | null;
  packs?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  variantSku?: string | null;
  pooky?: {
    baseIndex: number | null;
    shadeIndex: number | null;
    pendantIndex: number | null;
    wallFittingIndex: number | null;
    shadeTab: "shade" | "pendant";
  } | null;
};

export type ConfiguredPriceVerdict = {
  ok: boolean;
  /** Unit price to charge — the quoted one when it clears the floor. */
  unitPrice: number;
  /** Least this line could legitimately cost per unit. */
  floor: number;
  /** How the floor was reached, for the rejection message and logs. */
  basis: string;
  error?: string;
};

/**
 * Rounding, VAT presentation and promotional pricing all move the last penny
 * around, and a trade basket is legitimately 5% down. The floor is relaxed by
 * both so an honest basket is never refused; the attack this blocks is orders
 * of magnitude larger than the slack.
 */
const SLACK = 0.02;
const MAX_LEGITIMATE_DISCOUNT = TRADE_DISCOUNT_PERCENT / 100;

const round2 = (n: number) => Math.round(n * 100) / 100;

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The lowest per-unit figure the storefront could legitimately show. */
function lowestListedUnitRate(product: Record<string, any>): {
  rate: number;
  perSqm: boolean;
} {
  const resolved = resolveStorefrontUnitPrice({
    price: Number(product.price) || 0,
    brandSlug: product.brandSlug ?? null,
    brandName: product.brandName ?? null,
    pricePerM2: product.pricePerM2 ?? null,
    specs: (product.specs as Record<string, unknown>) ?? null,
  });

  // A live sale is a legitimate reason to be under the list price.
  const sale = num(product.salePrice);
  if (!resolved.perSqm && sale && sale < resolved.price) {
    return { rate: sale, perSqm: false };
  }
  return { rate: resolved.price, perSqm: resolved.perSqm };
}

/** Sum of the Pooky components this line actually selected. */
function pookyComponentTotal(
  product: Record<string, any>,
  sel: NonNullable<ConfiguredSelection["pooky"]>,
): number | null {
  const pick = (arr: unknown, index: number | null) => {
    if (index == null || !Array.isArray(arr)) return 0;
    const item = arr[index] as { price?: number } | undefined;
    return item ? Number(item.price) || 0 : 0;
  };
  const total =
    pick(product.wallFittings, sel.wallFittingIndex) +
    pick(product.bases, sel.baseIndex) +
    (sel.shadeTab === "pendant"
      ? pick(product.pendants, sel.pendantIndex)
      : pick(product.shades, sel.shadeIndex));
  return total > 0 ? round2(total) : null;
}

/** Listed price of the variant a UFHS kit resolved to. */
function variantPriceBySku(
  product: Record<string, any>,
  sku: string,
): number | null {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const match = variants.find(
    (v: { sku?: string }) => v?.sku && String(v.sku).trim() === sku.trim(),
  );
  return match ? num(match.price) : null;
}

/**
 * Decide whether a configured line's quoted price may be charged.
 *
 * Returns the price to charge (the quoted one, when it clears the floor) so the
 * customer is billed exactly what the configurator showed them.
 */
export function verifyConfiguredUnitPrice(
  product: Record<string, any>,
  sel: ConfiguredSelection,
): ConfiguredPriceVerdict {
  const claimed = Number(sel.claimedUnitPrice);
  const fail = (floor: number, basis: string, error: string) => ({
    ok: false,
    unitPrice: claimed,
    floor,
    basis,
    error,
  });

  if (!Number.isFinite(claimed) || claimed <= 0) {
    return fail(0, "no price", "This item has no price, so it cannot be sold.");
  }

  const { rate, perSqm } = lowestListedUnitRate(product);
  let floor = 0;
  let basis = "";

  switch (sel.kind) {
    case "area": {
      const area = num(sel.areaM2);
      if (!area) {
        return fail(0, "area missing", "This item is missing the area it covers.");
      }
      // Pro-rata is the cheapest an area line can be: pack rounding only ever
      // bills for more m² than were asked for.
      floor = rate * area;
      basis = `${area}m² × ${perSqm ? "£/m² rate" : "unit price"} ${rate}`;
      break;
    }
    case "pooky": {
      const components = sel.pooky ? pookyComponentTotal(product, sel.pooky) : null;
      if (components == null) {
        return fail(0, "no components", "Select the parts of this lamp again.");
      }
      // The combination is exactly the sum of its parts.
      floor = components;
      basis = `components ${components}`;
      break;
    }
    case "ufhs": {
      // Add-ons are extra on top of the variant, so the variant alone is the
      // floor. An unknown SKU falls back to the product's own rate.
      const variant = sel.variantSku
        ? variantPriceBySku(product, sel.variantSku)
        : null;
      floor = variant ?? rate;
      basis = variant ? `variant ${sel.variantSku} ${variant}` : `product rate ${rate}`;
      break;
    }
    case "size": {
      // A cut size is quoted from the listed size's rate; smaller-than-listed
      // still carries the minimum charge, so the base price is the floor.
      floor = rate;
      basis = `cut-to-size base ${rate}`;
      break;
    }
    case "colour":
    default: {
      // Finishes only ever add to the price.
      floor = rate;
      basis = `product rate ${rate}`;
      break;
    }
  }

  const allowed = round2(floor * (1 - MAX_LEGITIMATE_DISCOUNT) - SLACK);

  if (floor > 0 && claimed < allowed) {
    return fail(
      round2(floor),
      basis,
      `The price for "${product.name ?? "this item"}" has changed. Remove it and add it again to get the current price.`,
    );
  }

  return { ok: true, unitPrice: round2(claimed), floor: round2(floor), basis };
}

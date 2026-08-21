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

/**
 * Which Porcious-style price bracket an area falls into. Every zone shares
 * the same 4 brackets — "upto20" / "20to35" / "35plus1", then one
 * size-specific top bracket whose key name (e.g. "54plus") encodes its own
 * threshold — mirroring the bracket the on-page zone configurator itself
 * selects, so the two never disagree about which tier an order lands in.
 */
function zonePricingBracketKey(
  zoneRates: Record<string, unknown>,
  areaM2: number,
): string {
  const topKey = Object.keys(zoneRates).find(
    (k) => !["upto20", "20to35", "35plus1"].includes(k),
  );
  const topThreshold = topKey ? parseInt(topKey, 10) : 0;
  if (topKey && areaM2 >= topThreshold) return topKey;
  if (areaM2 > 35) return "35plus1";
  if (areaM2 > 20) return "20to35";
  return "upto20";
}

/**
 * Cheapest legitimate £/m² across every delivery zone, for the bracket this
 * area falls into. The browser's claimed delivery zone isn't independently
 * verifiable server-side (only a postcode-area label travels with the
 * order), so the floor uses the cheapest zone for that bracket rather than
 * trying to match one specific zone — every real zone × bracket combination
 * clears this, since none can ever be cheaper than the cheapest zone.
 */
function lowestZonePricingRate(
  zonePricing: Record<string, unknown>,
  areaM2: number,
): number | null {
  let lowest: number | null = null;
  for (const zoneRates of Object.values(zonePricing)) {
    if (!zoneRates || typeof zoneRates !== "object") continue;
    const bracket = zonePricingBracketKey(
      zoneRates as Record<string, unknown>,
      areaM2,
    );
    const rate = num((zoneRates as Record<string, unknown>)[bracket]);
    if (rate != null && (lowest == null || rate < lowest)) lowest = rate;
  }
  return lowest;
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
      // Porcious-style tiered zone pricing (specs.zonePricing) legitimately
      // charges less than the product's single flat rate once the order
      // crosses into a cheaper delivery zone or a larger order-size
      // bracket — floor against the cheapest zone's rate for the matching
      // bracket instead, so those orders aren't rejected as tampered.
      const zonePricing = (product.specs as Record<string, unknown> | undefined)
        ?.zonePricing as Record<string, unknown> | undefined;
      const zoneRate =
        zonePricing && typeof zonePricing === "object"
          ? lowestZonePricingRate(zonePricing, area)
          : null;
      const areaRate = zoneRate ?? rate;
      // Pro-rata is the cheapest an area line can be: pack rounding only ever
      // bills for more m² than were asked for.
      floor = areaRate * area;
      basis = zoneRate != null
        ? `${area}m² × cheapest zone rate ${areaRate}`
        : `${area}m² × ${perSqm ? "£/m² rate" : "unit price"} ${areaRate}`;
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

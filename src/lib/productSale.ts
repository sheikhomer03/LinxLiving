/**
 * A product's sale, held as multipliers rather than a fixed pair of prices.
 *
 * A sale is recorded once, against the product, but a product sells at many
 * prices: every variant, every option and every configurator total is a price
 * for the same product, and the same sale has to reach all of them. Holding it
 * as a ratio is what makes that possible — the "was" and "now" for any of
 * those prices are the product's own ratio applied to it, so picking a variant
 * neither drops the discount nor re-applies it to a figure that already
 * carries it.
 *
 * Both ways a sale gets recorded reduce to the same pair:
 *
 *  - **Raised compare-at, price kept** (`specs.salePriceMode` of
 *    `raise-was-keep-price`, and Shopify's own compare-at): `price` is already
 *    the live sell price and the higher figure is only the strike, so
 *    now = 1 and was = compareAt / price.
 *  - **Raised price, percentage off** (`raise-then-percent`): `price` is the
 *    inflated figure and the discount comes off it, so now = 1 - pct and
 *    was = 1.
 *
 * Precedence matches the storefront's: a live compare-at wins, and only when
 * there isn't one does `salePercent` discount the price. Applying both would
 * double-discount the Shopify-synced ranges that carry each.
 */

export type ProductSale = {
  /** Multiplier from a list price to what the customer actually pays. */
  nowRatio: number;
  /** Multiplier from a list price to the struck-through "Was". */
  wasRatio: number;
  /** True when the two differ — i.e. there is a sale to show. */
  onSale: boolean;
  /** What the customer pays for `price`. */
  now: (price: number) => number;
  /** The "Was" for `price`, or null when it would not be higher than "now". */
  was: (price: number) => number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function productSale(input: {
  price?: number | null;
  compareAtPrice?: number | null;
  salePercent?: number | null;
}): ProductSale {
  const base = Number(input.price);
  const compare = Number(input.compareAtPrice);
  const percent = Number(input.salePercent);

  let nowRatio = 1;
  let wasRatio = 1;

  if (
    Number.isFinite(base) &&
    base > 0 &&
    Number.isFinite(compare) &&
    compare > base
  ) {
    wasRatio = compare / base;
  } else if (Number.isFinite(percent) && percent > 0 && percent < 100) {
    nowRatio = 1 - percent / 100;
  }

  const now = (price: number) => {
    const value = Number(price);
    return Number.isFinite(value) ? round2(value * nowRatio) : 0;
  };
  const was = (price: number) => {
    const value = Number(price);
    if (!Number.isFinite(value) || value <= 0) return null;
    const struck = round2(value * wasRatio);
    // Rounding can flatten a small discount on a low price into the same
    // figure — a "Was" that isn't higher is not a sale worth striking.
    return struck > now(value) ? struck : null;
  };

  return { nowRatio, wasRatio, onSale: wasRatio > nowRatio, now, was };
}

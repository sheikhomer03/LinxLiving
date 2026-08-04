/**
 * VAT calculation for the storefront.
 *
 * Product prices are stored EX-VAT — the pricing engine writes
 * `sellPriceExVat` into `product.price` (see pricingEngine.ts and the supplier
 * sync). VAT is therefore added on top at the cart, never assumed to be baked
 * into the line price.
 *
 * Each line can carry its own rate so zero-rated or reduced-rate goods stay
 * correct; anything without an explicit rate falls back to UK standard 20%.
 */

export const UK_STANDARD_VAT_RATE = 20;

export type VatLine = {
  price: number;
  quantity: number;
  vatRate?: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function rateFor(line: VatLine) {
  const r = Number(line.vatRate);
  return Number.isFinite(r) && r >= 0 ? r : UK_STANDARD_VAT_RATE;
}

/** Net (ex-VAT) total of the given lines. */
export function netTotal(lines: VatLine[]) {
  return round2(
    lines.reduce((sum, l) => sum + (l.price || 0) * (l.quantity || 0), 0),
  );
}

/**
 * VAT due on the lines, after apportioning any order-level discount.
 *
 * A discount reduces the taxable amount, so VAT must be charged on the
 * discounted net — charging VAT on the pre-discount figure would overcharge.
 * Shipping is standard-rated in the UK when the goods are.
 */
export function calculateVat(options: {
  lines: VatLine[];
  discountAmount?: number;
  shippingCost?: number;
  shippingVatRate?: number;
}) {
  const { lines, discountAmount = 0, shippingCost = 0 } = options;

  const net = netTotal(lines);
  const discount = Math.min(Math.max(discountAmount, 0), net);
  const discountFactor = net > 0 ? (net - discount) / net : 0;

  let goodsVat = 0;
  for (const line of lines) {
    const lineNet = (line.price || 0) * (line.quantity || 0) * discountFactor;
    goodsVat += lineNet * (rateFor(line) / 100);
  }

  const shippingVatRate =
    options.shippingVatRate ?? UK_STANDARD_VAT_RATE;
  const shippingVat = (shippingCost || 0) * (shippingVatRate / 100);

  const vatAmount = round2(goodsVat + shippingVat);
  const netAfterDiscount = round2(net - discount);
  const grandTotal = round2(netAfterDiscount + (shippingCost || 0) + vatAmount);

  return {
    /** Goods total excluding VAT, before discount */
    subtotalExVat: net,
    discount: round2(discount),
    /** Goods total excluding VAT, after discount */
    netAfterDiscount,
    shippingCost: round2(shippingCost || 0),
    vatAmount,
    /** What the customer pays */
    grandTotal,
  };
}

/** True when every line carries the same rate — lets the UI print "VAT (20%)". */
export function singleVatRate(lines: VatLine[]): number | null {
  if (!lines.length) return UK_STANDARD_VAT_RATE;
  const rates = new Set(lines.map(rateFor));
  return rates.size === 1 ? [...rates][0] : null;
}

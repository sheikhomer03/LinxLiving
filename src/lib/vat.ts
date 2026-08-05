/**
 * VAT calculation for the storefront.
 *
 * Product prices are stored and displayed INCLUSIVE of VAT — the customer sees
 * one all-in price and pays exactly that. VAT is therefore *extracted* from the
 * gross figure for the receipt breakdown, never added on top; adding it would
 * charge the customer 20% more than the price on the card.
 *
 *     vat = gross x rate / (100 + rate)
 *
 * Each line can carry its own rate so zero-rated or reduced-rate goods stay
 * correct; anything without an explicit rate falls back to UK standard 20%.
 */

export const UK_STANDARD_VAT_RATE = 20;

export type VatLine = {
  /** Gross unit price, including VAT */
  price: number;
  quantity: number;
  vatRate?: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function rateFor(line: VatLine) {
  const r = Number(line.vatRate);
  return Number.isFinite(r) && r >= 0 ? r : UK_STANDARD_VAT_RATE;
}

/** Gross (VAT-inclusive) total of the given lines. */
export function grossTotal(lines: VatLine[]) {
  return round2(
    lines.reduce((sum, l) => sum + (l.price || 0) * (l.quantity || 0), 0),
  );
}

/** Back-compat alias — the basket total as displayed. */
export const netTotal = grossTotal;

/**
 * Break a VAT-inclusive basket into its net and VAT parts.
 *
 * A discount reduces the taxable amount, so the VAT element is taken from the
 * discounted gross. Shipping is treated as VAT-inclusive for the same reason.
 */
export function calculateVat(options: {
  lines: VatLine[];
  discountAmount?: number;
  shippingCost?: number;
  shippingVatRate?: number;
}) {
  const { lines, discountAmount = 0, shippingCost = 0 } = options;

  const gross = grossTotal(lines);
  const discount = Math.min(Math.max(discountAmount, 0), gross);
  const discountFactor = gross > 0 ? (gross - discount) / gross : 0;

  let goodsVat = 0;
  for (const line of lines) {
    const lineGross = (line.price || 0) * (line.quantity || 0) * discountFactor;
    const rate = rateFor(line);
    goodsVat += lineGross * (rate / (100 + rate));
  }

  const shippingRate = options.shippingVatRate ?? UK_STANDARD_VAT_RATE;
  const shippingVat =
    (shippingCost || 0) * (shippingRate / (100 + shippingRate));

  const vatAmount = round2(goodsVat + shippingVat);
  const grossAfterDiscount = round2(gross - discount);
  const grandTotal = round2(grossAfterDiscount + (shippingCost || 0));

  return {
    /** Goods total as displayed, including VAT, before discount */
    subtotalIncVat: gross,
    /** Kept for callers that still read this name */
    subtotalExVat: round2(gross - round2(goodsVat / (discountFactor || 1))),
    discount: round2(discount),
    /** Goods total including VAT, after discount */
    netAfterDiscount: grossAfterDiscount,
    shippingCost: round2(shippingCost || 0),
    /** VAT contained within grandTotal */
    vatAmount,
    /** What the customer pays — equals the prices shown on the cards */
    grandTotal,
  };
}

/** True when every line carries the same rate — lets the UI print "VAT (20%)". */
export function singleVatRate(lines: VatLine[]): number | null {
  if (!lines.length) return UK_STANDARD_VAT_RATE;
  const rates = new Set(lines.map(rateFor));
  return rates.size === 1 ? [...rates][0] : null;
}

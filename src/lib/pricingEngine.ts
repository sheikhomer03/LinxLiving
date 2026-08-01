/**
 * LINX pricing engine — cost stack → ex-VAT sell → optional VAT-inc retail.
 * UK default margins from commercial guidance (launch rules).
 */

export type CostStack = {
  costPrice?: number | null;
  importCost?: number | null;
  deliveryCost?: number | null;
  dutyCost?: number | null;
  packagingCost?: number | null;
  handlingCost?: number | null;
  overheadCost?: number | null;
  /** Gross margin % on landed cost (ex VAT) */
  marginPercent?: number | null;
  /** VAT rate %, default UK 20 */
  vatRate?: number | null;
};

export type PricingResult = {
  landedCostExVat: number;
  sellPriceExVat: number;
  sellPriceIncVat: number;
  marginPercent: number;
  vatRate: number;
  vatAmount: number;
  grossProfitExVat: number;
};

/** Category keyword → target gross margin % */
const CATEGORY_MARGIN_RULES: { match: RegExp; margin: number }[] = [
  { match: /accessories|spare|parts?/i, margin: 60 },
  { match: /furniture/i, margin: 45 },
  { match: /kitchen/i, margin: 40 },
  { match: /bathroom|sanitary|basin|tap|faucet|shower|bathtub/i, margin: 40 },
  { match: /pergola|awning/i, margin: 40 },
  { match: /rooflight|roof.?light|skylight|loft.?ladder/i, margin: 35 },
  { match: /window|door|glazing/i, margin: 35 },
  { match: /floor|tile|parquet|vinyl|laminate/i, margin: 35 },
  { match: /garden|outdoor/i, margin: 35 },
  { match: /light(ing)?/i, margin: 40 },
  { match: /tool/i, margin: 20 },
  { match: /electr/i, margin: 25 },
  { match: /plumb|heat/i, margin: 25 },
  { match: /build|install|adhesive|grout|profile/i, margin: 25 },
];

export const DEFAULT_UK_MARGIN = 35;
export const DEFAULT_IMPORT_MARGIN = 42.5;
export const DEFAULT_VAT_RATE = 20;

export function defaultMarginForCategory(
  category?: string | null,
  opts?: { isImport?: boolean },
): number {
  const cat = String(category || "");
  for (const rule of CATEGORY_MARGIN_RULES) {
    if (rule.match.test(cat)) return rule.margin;
  }
  return opts?.isImport ? DEFAULT_IMPORT_MARGIN : DEFAULT_UK_MARGIN;
}

function n(v: number | null | undefined): number {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
}

export function landedCostExVat(stack: CostStack): number {
  return (
    n(stack.costPrice) +
    n(stack.importCost) +
    n(stack.deliveryCost) +
    n(stack.dutyCost) +
    n(stack.packagingCost) +
    n(stack.handlingCost) +
    n(stack.overheadCost)
  );
}

/** Compute sell prices from cost stack + margin. */
export function calculateSellPrice(stack: CostStack): PricingResult {
  const landed = Math.round(landedCostExVat(stack) * 100) / 100;
  const margin =
    stack.marginPercent != null && Number.isFinite(Number(stack.marginPercent))
      ? Number(stack.marginPercent)
      : DEFAULT_UK_MARGIN;
  const vatRate =
    stack.vatRate != null && Number.isFinite(Number(stack.vatRate))
      ? Number(stack.vatRate)
      : DEFAULT_VAT_RATE;

  const sellEx =
    Math.round(landed * (1 + margin / 100) * 100) / 100;
  const vatAmount = Math.round(sellEx * (vatRate / 100) * 100) / 100;
  const sellInc = Math.round((sellEx + vatAmount) * 100) / 100;

  return {
    landedCostExVat: landed,
    sellPriceExVat: sellEx,
    sellPriceIncVat: sellInc,
    marginPercent: margin,
    vatRate,
    vatAmount,
    grossProfitExVat: Math.round((sellEx - landed) * 100) / 100,
  };
}

/**
 * Score a supplier offer for auto-selection.
 * Higher = better. Prefer in-stock, lower total cost, shorter lead, higher priority.
 */
export function scoreSupplierOffer(offer: {
  stock?: number | null;
  costPrice?: number | null;
  deliveryCost?: number | null;
  leadTimeDays?: number | null;
  priority?: number | null;
  isPreferred?: boolean;
}): number {
  const stock = Number(offer.stock) || 0;
  const cost = n(offer.costPrice) + n(offer.deliveryCost);
  const lead = offer.leadTimeDays != null ? Number(offer.leadTimeDays) : 14;
  const priority = offer.priority != null ? Number(offer.priority) : 100;

  let score = 0;
  if (stock > 0) score += 10_000;
  else score -= 5_000;
  if (offer.isPreferred) score += 500;
  // Lower cost → higher score
  score += Math.max(0, 5_000 - cost * 10);
  // Shorter lead → higher score
  score += Math.max(0, 500 - lead * 10);
  // Lower priority number → higher score
  score += Math.max(0, 200 - priority);
  return score;
}

export function pickBestSupplierOffer<
  T extends {
    stock?: number | null;
    costPrice?: number | null;
    deliveryCost?: number | null;
    leadTimeDays?: number | null;
    priority?: number | null;
    isPreferred?: boolean;
    isActive?: boolean;
  },
>(offers: T[]): T | null {
  const active = offers.filter((o) => o.isActive !== false);
  if (!active.length) return null;
  return active
    .slice()
    .sort((a, b) => scoreSupplierOffer(b) - scoreSupplierOffer(a))[0];
}

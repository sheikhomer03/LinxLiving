/**
 * Trade accounts.
 *
 * Trade customers pay 5% less than the listed price. Product prices are NOT
 * changed — the reduction is applied once, at the basket, as its own line so
 * the customer can see what they saved and retail pricing stays untouched
 * everywhere else on the site.
 */

export const TRADE_DISCOUNT_PERCENT = 5;

/** The 5% reduction on a VAT-inclusive goods total. */
export function tradeDiscountAmount(subtotalIncVat: number, isTrade: boolean) {
  if (!isTrade) return 0;
  const n = Number(subtotalIncVat);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * (TRADE_DISCOUNT_PERCENT / 100) * 100) / 100;
}

/** "Trade discount (5%)" — used in cart, checkout and the order record. */
export const TRADE_DISCOUNT_LABEL = `Trade discount (${TRADE_DISCOUNT_PERCENT}%)`;

/** Reads the flag off a next-auth session user without leaking `any`. */
export function isTradeAccount(user: unknown): boolean {
  return Boolean(
    user && typeof user === "object" && (user as { isTradeAccount?: boolean }).isTradeAccount,
  );
}

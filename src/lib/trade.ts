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

/**
 * Self-serve "Trade Mode" — a no-login toggle (see useTradeModeStore) that
 * shows the same 5% reduction while browsing, not just at checkout. Kept
 * separate from `isTradeAccount` (a real, admin-approved account) so the two
 * concepts never get confused: a genuine trade account is always discounted
 * regardless of this toggle; everyone else only gets it while the toggle is
 * on. Combine with `isTradeAccount(session?.user)` via `||` wherever a
 * shopper's discount eligibility is decided.
 */

/** Per-unit price a shopper pays once any Trade Mode reduction applies. */
export function tradeUnitPrice(price: number, isTrade: boolean): number {
  const n = Number(price);
  if (!isTrade || !Number.isFinite(n) || n <= 0) return n;
  return Math.round(n * (1 - TRADE_DISCOUNT_PERCENT / 100) * 100) / 100;
}

/** Short badge/tag copy shown next to a trade-reduced price. */
export const TRADE_PRICE_TAG = `Trade price −${TRADE_DISCOUNT_PERCENT}%`;

/**
 * Trade accounts.
 *
 * Trade customers pay 5% less than the listed price. Product prices are NOT
 * changed — the reduction is applied once, at the basket, as its own line so
 * the customer can see what they saved and retail pricing stays untouched
 * everywhere else on the site.
 *
 * There are two ways to be on trade pricing, deliberately kept apart:
 *
 *   - an **approved trade account** (`user.isTradeAccount`), granted by an
 *     admin from the application at /trade, which may be limited to particular
 *     departments;
 *   - **Trade Mode** (see useTradeModeStore), a no-login toggle that shows the
 *     same reduction while browsing and applies across every department.
 *
 * `tradeScopeFor()` collapses the two into one value, and everything that
 * prices anything takes that value rather than a bare boolean. That is the
 * whole point: a bare boolean cannot express "5% off, but only on flooring".
 */

export const TRADE_DISCOUNT_PERCENT = 5;

/** "Trade discount (5%)" — used in cart, checkout and the order record. */
export const TRADE_DISCOUNT_LABEL = `Trade discount (${TRADE_DISCOUNT_PERCENT}%)`;

/** Short badge/tag copy shown next to a trade-reduced price. */
export const TRADE_PRICE_TAG = `Trade price −${TRADE_DISCOUNT_PERCENT}%`;

/** The application form's "everything" option. Stored as an empty list. */
export const TRADE_ALL_DEPARTMENTS = "all";

/**
 * Who gets the reduction, and on what.
 *
 * `departments: null` means every department — both the Trade Mode toggle and
 * an approved account that was granted "All departments". A non-empty list
 * limits it to those department slugs.
 */
export type TradeScope = {
  active: boolean;
  departments: string[] | null;
};

/** Nobody gets a reduction. The safe default everywhere. */
export const NO_TRADE: TradeScope = { active: false, departments: null };

/** Reads the flag off a next-auth session user without leaking `any`. */
export function isTradeAccount(user: unknown): boolean {
  return Boolean(
    user &&
      typeof user === "object" &&
      (user as { isTradeAccount?: boolean }).isTradeAccount,
  );
}

/** Department slugs an approved account is limited to, off the session user. */
export function tradeDepartmentsOf(user: unknown): string[] {
  if (!user || typeof user !== "object") return [];
  const list = (user as { tradeDepartments?: unknown }).tradeDepartments;
  if (!Array.isArray(list)) return [];
  return list.map((d) => normaliseDepartment(d)).filter(Boolean);
}

/** Department slugs compare case-insensitively and ignore surrounding space. */
function normaliseDepartment(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * The one place the two mechanisms are combined.
 *
 * An approved account wins over the toggle when it is unrestricted, because it
 * is the stronger claim and needs no toggle to work. A *restricted* account
 * that also has the toggle on gets the toggle's unrestricted reach — the
 * toggle is open to everyone anyway, so refusing it here would leave a trade
 * customer worse off than an anonymous one.
 */
export function tradeScopeFor(
  user: unknown,
  tradeModeOn: boolean,
): TradeScope {
  const account = isTradeAccount(user);
  const departments = account ? tradeDepartmentsOf(user) : [];

  if (tradeModeOn) return { active: true, departments: null };
  if (!account) return NO_TRADE;
  return { active: true, departments: departments.length ? departments : null };
}

/** Does this scope cover a product/line in `department`? */
export function tradeAppliesTo(
  department: string | null | undefined,
  scope: TradeScope,
): boolean {
  if (!scope.active) return false;
  if (!scope.departments) return true;
  const slug = normaliseDepartment(department);
  if (!slug) return false;
  return scope.departments.includes(slug);
}

/**
 * Per-unit price a shopper pays once any reduction applies.
 *
 * Takes a plain boolean rather than a scope: the caller has already decided
 * eligibility for this particular product, usually via `tradeAppliesTo`.
 */
export function tradeUnitPrice(price: number, isTrade: boolean): number {
  const n = Number(price);
  if (!isTrade || !Number.isFinite(n) || n <= 0) return n;
  return Math.round(n * (1 - TRADE_DISCOUNT_PERCENT / 100) * 100) / 100;
}

/** The 5% reduction on a VAT-inclusive goods total. */
export function tradeDiscountAmount(subtotalIncVat: number, isTrade: boolean) {
  if (!isTrade) return 0;
  const n = Number(subtotalIncVat);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * (TRADE_DISCOUNT_PERCENT / 100) * 100) / 100;
}

/** A basket line, reduced to what pricing needs to know about it. */
export type TradeLine = {
  price: number;
  quantity: number;
  department?: string | null;
};

/**
 * The basket's reduction, counting only lines the scope covers.
 *
 * Rounded once at the end rather than per line, so the figure matches
 * `tradeDiscountAmount` exactly when every line is eligible — a per-line round
 * drifts by a penny or two across a long basket and the cart and the charge
 * then disagree.
 */
export function tradeDiscountForLines(
  lines: TradeLine[],
  scope: TradeScope,
): number {
  if (!scope.active) return 0;
  const eligible = (lines || []).reduce((sum, line) => {
    if (!tradeAppliesTo(line.department, scope)) return sum;
    const price = Number(line.price) || 0;
    const qty = Number(line.quantity) || 0;
    return sum + price * qty;
  }, 0);
  return tradeDiscountAmount(eligible, true);
}

/** Human summary of what an account covers — admin table and emails. */
export function describeTradeDepartments(
  departments: string[] | null | undefined,
  lookup?: (slug: string) => string | undefined,
): string {
  const list = (departments || []).map(normaliseDepartment).filter(Boolean);
  if (!list.length) return "All departments";
  return list.map((slug) => lookup?.(slug) || slug).join(", ");
}

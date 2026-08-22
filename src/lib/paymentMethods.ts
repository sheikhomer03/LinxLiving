/**
 * Payment methods advertised on the storefront.
 *
 * Driven by `NEXT_PUBLIC_PAYMENT_METHODS` so the badges can never promise
 * something checkout cannot deliver. The storefront sends every basket to
 * Shopify Checkout, so the source of truth is Shopify admin → Settings →
 * Payments: whatever is enabled there (Klarna sits under Shopify Payments →
 * Payment methods → Local payment methods) is what a customer can actually
 * reach. This list is what the site *says* is available, and the two must be
 * kept in step.
 *
 * Note that Shopify's "Managed payment methods" setting personalises which
 * methods surface per customer, and Klarna runs its own affordability check on
 * top of that. Neither is visible from here, which is why nothing in this file
 * promises instalments outright — see `klarnaInstalment` below.
 *
 *   NEXT_PUBLIC_PAYMENT_METHODS=klarna,paypal
 *
 * Defaults to Klarna and PayPal.
 */

export type PaymentMethodId = "card" | "klarna" | "paypal";

export type PaymentMethod = {
  id: PaymentMethodId;
  label: string;
  /** Short line shown under the label where there is room. */
  blurb?: string;
};

const CATALOGUE: Record<PaymentMethodId, PaymentMethod> = {
  card: { label: "Card", id: "card", blurb: "Visa, Mastercard, Amex" },
  klarna: {
    id: "klarna",
    label: "Klarna",
    blurb: "Spread the cost",
  },
  paypal: { id: "paypal", label: "PayPal", blurb: "Pay in your own way" },
};

/** Methods to advertise, in display order. */
export function enabledPaymentMethods(): PaymentMethod[] {
  // Card is not advertised — every shop takes cards, so the badge said
  // nothing. Klarna and PayPal are the ones worth calling out.
  const raw = process.env.NEXT_PUBLIC_PAYMENT_METHODS || "klarna,paypal";
  const ids = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PaymentMethodId => s in CATALOGUE);
  const unique = [...new Set(ids)];
  return unique.map((id) => CATALOGUE[id]);
}

/** True when Klarna is advertised at all. */
export function hasKlarna(): boolean {
  return enabledPaymentMethods().some((m) => m.id === "klarna");
}

/** The number of payments a Klarna "pay in 3" plan splits a basket into. */
export const KLARNA_INSTALMENTS = 3;

/**
 * Basket range Klarna will consider for pay-in-3, in pounds.
 *
 * Klarna sets these per merchant agreement and changes them, so they are
 * env-driven rather than baked in — confirm the live figures against the
 * Klarna merchant portal and set them there:
 *
 *   NEXT_PUBLIC_KLARNA_MIN=35
 *   NEXT_PUBLIC_KLARNA_MAX=1000
 *
 * The defaults are deliberately conservative. Quoting instalments on a basket
 * Klarna will refuse is the failure that matters: the customer reaches
 * checkout, cannot find what the cart promised, and abandons. Showing nothing
 * on a basket that would in fact have qualified only costs a nudge.
 */
const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const KLARNA_MIN = num(process.env.NEXT_PUBLIC_KLARNA_MIN, 35);
export const KLARNA_MAX = num(process.env.NEXT_PUBLIC_KLARNA_MAX, 1000);

export type KlarnaInstalment = {
  /** Each of the three payments, rounded to the penny. */
  perInstalment: number;
  instalments: number;
};

/**
 * What a basket splits into, or null when instalments must not be advertised.
 *
 * Null covers Klarna being switched off, a non-finite or zero amount, and a
 * basket outside the range above. Callers render nothing on null rather than
 * falling back to a generic claim — an unconditional "interest free" line is
 * the thing this function exists to prevent.
 *
 * Eligibility is ultimately Klarna's call, made per customer at checkout after
 * an affordability check. This is a basket-size filter, not a promise, so the
 * wording around it stays conditional wherever it is used.
 */
export function klarnaInstalment(amount: number): KlarnaInstalment | null {
  if (!hasKlarna()) return null;
  const total = Number(amount);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (total < KLARNA_MIN || total > KLARNA_MAX) return null;

  return {
    perInstalment: Math.round((total / KLARNA_INSTALMENTS) * 100) / 100,
    instalments: KLARNA_INSTALMENTS,
  };
}

/**
 * Payment methods advertised on the storefront.
 *
 * Driven by `NEXT_PUBLIC_PAYMENT_METHODS` so the badges can never promise
 * something checkout cannot deliver. Stripe Checkout offers whatever is
 * switched on in the Stripe Dashboard; this list is what the site *says* is
 * available, and the two must be kept in step.
 *
 * Klarna is consumer credit and PayPal is a regulated payment service —
 * advertising either before it is live in Stripe is worse than not
 * advertising it at all, because a customer reaches checkout, cannot find it,
 * and abandons.
 *
 *   NEXT_PUBLIC_PAYMENT_METHODS=card,klarna,paypal
 *
 * Defaults to card only.
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
    blurb: "Interest free",
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

/** True when instalments may be advertised. */
export function hasKlarna(): boolean {
  return enabledPaymentMethods().some((m) => m.id === "klarna");
}

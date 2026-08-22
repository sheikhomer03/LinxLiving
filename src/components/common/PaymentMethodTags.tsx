import { enabledPaymentMethods, klarnaInstalment } from "@/lib/paymentMethods";
import { cn } from "@/lib/utils";

/**
 * Klarna / PayPal badges, and the instalment line that goes with them.
 *
 * Word marks set in type, on each brand's own background colour — Klarna's
 * pink and PayPal's navy. Deliberately not their actual logo files: both
 * licence their brand assets and their guidelines govern colour, clear space
 * and minimum size. Once the merchant accounts are approved you are sent the
 * official SVGs; drop them in and swap `KlarnaMark` / `PayPalMark` for them.
 *
 * Which badges appear is set by NEXT_PUBLIC_PAYMENT_METHODS and must match
 * what is switched on in Shopify admin → Settings → Payments, or the site
 * promises a payment method Shopify Checkout cannot offer.
 *
 * Two different claims live in this file and they are not interchangeable:
 *
 *   - that Klarna and PayPal are *accepted*, which is true of every basket
 *     once they are enabled in Shopify, and
 *   - that this basket can be *split into three payments*, which is true only
 *     within Klarna's basket range and only for customers Klarna approves.
 *
 * Anything quoting a figure therefore takes an `amount` and renders nothing
 * when the basket falls outside that range. Passing no `amount` gets the marks
 * and no instalment claim at all — that is the right thing in a footer or a
 * product card, where there is no basket to quote against.
 */

const KLARNA_PINK = "#FFB3C7";
const KLARNA_INK = "#0B051D";
const PAYPAL_NAVY = "#003087";
const PAYPAL_BLUE = "#009CDE";

const money = (n: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function KlarnaMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] font-bold leading-none ${
        compact ? "px-1.5 py-1 text-[10px]" : "px-2 py-1.5 text-[11px]"
      }`}
      style={{ backgroundColor: KLARNA_PINK, color: KLARNA_INK }}
    >
      Klarna
    </span>
  );
}

function PayPalMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] font-bold italic leading-none ${
        compact ? "px-1.5 py-1 text-[10px]" : "px-2 py-1.5 text-[11px]"
      }`}
      style={{ backgroundColor: PAYPAL_NAVY, color: "#ffffff" }}
    >
      Pay<span style={{ color: PAYPAL_BLUE }}>Pal</span>
    </span>
  );
}

function CardMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] border border-foreground/20 bg-white font-bold leading-none text-foreground ${
        compact ? "px-1.5 py-1 text-[10px]" : "px-2 py-1.5 text-[11px]"
      }`}
    >
      Card
    </span>
  );
}

function Mark({ id, compact }: { id: string; compact?: boolean }) {
  if (id === "klarna") return <KlarnaMark compact={compact} />;
  if (id === "paypal") return <PayPalMark compact={compact} />;
  return <CardMark compact={compact} />;
}

/**
 * Klarna decides per customer, at checkout, after its own affordability check.
 * Every figure this file prints therefore carries the qualifier alongside it.
 */
function SubjectToStatus({ className = "" }: { className?: string }) {
  return (
    <span className={cn("text-[10px] text-muted-foreground", className)}>
      Subject to status
    </span>
  );
}

/**
 * The payment strip.
 *
 * With an `amount` that Klarna would consider, it leads with the real
 * per-instalment figure for this basket. With an `amount` outside that range
 * it shows the marks alone — the methods are still accepted, there is simply
 * no instalment plan to quote. With no `amount` it makes no claim about
 * splitting the cost at all.
 *
 * `compact` drops the wording and shows the marks alone, for tight spots like
 * a product card footer.
 */
export function PaymentMethodTags({
  className = "",
  compact = false,
  showBlurb = false,
  amount,
}: {
  className?: string;
  compact?: boolean;
  /** Show a trailing line of supporting copy where there is room. */
  showBlurb?: boolean;
  /**
   * Basket or item total to quote instalments against. Omit where there is no
   * total in scope; the strip then advertises the methods without promising a
   * plan.
   */
  amount?: number;
}) {
  const methods = enabledPaymentMethods();
  if (!methods.length) return null;

  const plan = amount === undefined ? null : klarnaInstalment(amount);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {!compact && plan ? (
        <span className="text-[11px] font-medium text-muted-foreground">
          {plan.instalments} payments of{" "}
          <span className="font-semibold text-foreground">
            £{money(plan.perInstalment)}
          </span>{" "}
          with
        </span>
      ) : null}
      {methods.map((m) => (
        <Mark key={m.id} id={m.id} compact={compact} />
      ))}
      {!compact && plan ? <SubjectToStatus /> : null}
      {showBlurb && !compact && !plan ? (
        <span className="text-[11px] text-foreground">
          · Spread the cost at checkout
        </span>
      ) : null}
    </div>
  );
}

/**
 * One-line instalment message for a product page, under the price.
 *
 * Quotes the split and no more — Klarna sets the term and eligibility per
 * basket and per customer at checkout, so anything firmer would be a credit
 * promotion we cannot stand behind. Renders nothing for an item Klarna would
 * not consider, which on this catalogue is most of the adhesives and trims.
 */
export function KlarnaInstalmentNote({
  price,
  className = "",
}: {
  price: number;
  className?: string;
}) {
  const plan = klarnaInstalment(price);
  if (!plan) return null;

  const hasPaypal = enabledPaymentMethods().some((m) => m.id === "paypal");

  return (
    <p
      className={`flex flex-wrap items-center gap-1.5 text-[12px] text-foreground ${className}`}
    >
      <span>
        Or {plan.instalments} payments of{" "}
        <span className="font-semibold text-foreground">
          £{money(plan.perInstalment)}
        </span>{" "}
        with
      </span>
      <KlarnaMark compact />
      {hasPaypal ? (
        <>
          <span>or</span>
          <PayPalMark compact />
        </>
      ) : null}
      <SubjectToStatus />
    </p>
  );
}

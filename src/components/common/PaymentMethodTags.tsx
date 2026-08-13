import { enabledPaymentMethods } from "@/lib/paymentMethods";
import { cn } from "@/lib/utils";

/**
 * "Interest free with Klarna · PayPal" badges.
 *
 * Word marks set in type, on each brand's own background colour — Klarna's
 * pink and PayPal's navy. Deliberately not their actual logo files: both
 * licence their brand assets and their guidelines govern colour, clear space
 * and minimum size. Once the merchant accounts are approved you are sent the
 * official SVGs; drop them in and swap `KlarnaMark` / `PayPalMark` for them.
 *
 * Which badges appear is set by NEXT_PUBLIC_PAYMENT_METHODS and must match
 * what is switched on in the Stripe Dashboard, or the site promises a payment
 * method checkout cannot offer.
 */

const KLARNA_PINK = "#FFB3C7";
const KLARNA_INK = "#0B051D";
const PAYPAL_NAVY = "#003087";
const PAYPAL_BLUE = "#009CDE";

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
 * The full strip: "Interest free with [Klarna] [PayPal]".
 *
 * `compact` drops the wording and shows the marks alone, for tight spots like
 * a product card footer.
 */
export function PaymentMethodTags({
  className = "",
  compact = false,
  showBlurb = false,
}: {
  className?: string;
  compact?: boolean;
  /** Show "Interest free with" before the marks. */
  showBlurb?: boolean;
}) {
  const methods = enabledPaymentMethods();
  if (!methods.length) return null;

  const hasKlarna = methods.some((m) => m.id === "klarna");

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {!compact && hasKlarna ? (
        <span className="text-[11px] font-medium text-muted-foreground">
          Interest free with
        </span>
      ) : null}
      {methods.map((m) => (
        <Mark key={m.id} id={m.id} compact={compact} />
      ))}
      {showBlurb && !compact ? (
        <span className="text-[11px] text-foreground/50">
          · Spread the cost at checkout
        </span>
      ) : null}
    </div>
  );
}

/**
 * One-line instalment message for a product page, under the price.
 *
 * Says "3 interest-free payments" and no more — Klarna sets the APR, term and
 * eligibility per basket and per customer at checkout, so quoting them here
 * would be a credit promotion we cannot stand behind.
 */
export function KlarnaInstalmentNote({
  price,
  className = "",
}: {
  price: number;
  className?: string;
}) {
  const methods = enabledPaymentMethods();
  if (!methods.some((m) => m.id === "klarna")) return null;
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const perInstalment = Math.round((amount / 3) * 100) / 100;

  return (
    <p
      className={`flex flex-wrap items-center gap-1.5 text-[12px] text-foreground/65 ${className}`}
    >
      <span>
        Or 3 interest-free payments of{" "}
        <span className="font-semibold text-foreground">
          £
          {perInstalment.toLocaleString("en-GB", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>{" "}
        with
      </span>
      <KlarnaMark compact />
    </p>
  );
}

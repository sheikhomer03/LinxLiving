"use client";

import {
  Star,
  PackageOpen,
  BadgePercent,
  Headset,
  Truck,
  Ruler,
  CreditCard,
} from "lucide-react";
import { DEFAULT_SUPPORT_PHONE } from "@/lib/company";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/shipping";
import { enabledPaymentMethods, hasKlarna } from "@/lib/paymentMethods";

/**
 * Service strip under the navigation — icon, bold headline, small supporting
 * line, in the builders'-merchant style.
 *
 * Lives inside the fixed header rather than on the homepage so it appears on
 * every page. Imports its phone number from `@/lib/company`, not
 * `@/lib/support`: the latter reaches for the Settings model and would drag
 * mongoose into the browser bundle from this client component.
 *
 * One row at every width. Below `lg` it scrolls horizontally rather than
 * wrapping into a tall block that pushes the page content down.
 *
 * Every entry is a real service: samples are a free request, trade accounts
 * are open on application, the number is the live support line, delivery is
 * the flat rate charged at checkout.
 */
export function ServiceStrip({
  rating,
  reviewCount,
}: {
  rating?: number;
  reviewCount?: number;
}) {
  const payMethods = enabledPaymentMethods();
  const items = [
    {
      icon: PackageOpen,
      title: "Free Samples",
      detail: "See the finish before you commit",
    },
    {
      icon: BadgePercent,
      title: "Trade Account",
      detail: "Trade prices on every range",
    },
    {
      icon: Headset,
      title: "Expert Advice",
      detail: `Speak to our team · ${DEFAULT_SUPPORT_PHONE}`,
    },
    {
      icon: Truck,
      title: "Free Delivery",
      detail: `On orders over £${FREE_DELIVERY_THRESHOLD}`,
    },
    reviewCount
      ? {
          icon: Star,
          title: `Rated ${Number(rating || 0).toFixed(2)}/5`,
          detail: `${reviewCount} reviews on Reviews.io`,
        }
      : {
          icon: Ruler,
          title: "Sold By The m²",
          detail: "Calculator on every tile and floor",
        },
    // Only advertised when the method is actually switched on — see
    // paymentMethods.ts. Promising Klarna before it is live in Stripe sends
    // customers to a checkout that cannot offer it.
    ...(payMethods.length
      ? [
          {
            icon: CreditCard,
            title: payMethods.map((m) => m.label).join(" & "),
            detail: hasKlarna()
              ? "Interest free instalments available"
              : "Pay your way at checkout",
          },
        ]
      : []),
  ];

  return (
    <div className="border-t border-foreground/10 bg-[#f6f1e9]">
      <div
        className="no-scrollbar mx-auto flex max-w-[1400px] snap-x snap-mandatory items-center gap-6
                   overflow-x-auto px-5 py-2.5 lg:justify-between lg:gap-6 lg:overflow-visible lg:px-10"
      >
        {items.map(({ icon: Icon, title, detail }) => (
          <div
            key={title}
            className="flex shrink-0 snap-start items-center gap-2.5 lg:min-w-0 lg:shrink"
          >
            <Icon
              className="h-5 w-5 shrink-0 text-primary lg:h-6 lg:w-6"
              strokeWidth={1.6}
            />
            <div className="lg:min-w-0">
              <p className="whitespace-nowrap text-[11px] font-bold leading-tight text-foreground lg:truncate lg:text-[12px]">
                {title}
              </p>
              <p className="whitespace-nowrap text-[9px] leading-tight text-foreground/60 lg:truncate lg:text-[10px]">
                {detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

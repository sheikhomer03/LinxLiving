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
 * Service strip under the navigation — icon, letter-spaced headline, small
 * supporting line.
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
      detail: DEFAULT_SUPPORT_PHONE,
    },
    {
      icon: Truck,
      title: "Free Delivery",
      detail: `On orders over £${FREE_DELIVERY_THRESHOLD}`,
      // The threshold is the whole point of the claim, so it travels with the
      // title rather than living in a phrase the desktop row does not show.
      short: `Free Delivery over £${FREE_DELIVERY_THRESHOLD}`,
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
    // paymentMethods.ts. Promising Klarna before it is live in Shopify sends
    // customers to a checkout that cannot offer it.
    //
    // No basket is in scope on a site-wide strip, so this says instalments
    // exist rather than that this customer will get them — Klarna approves
    // per basket and per customer at checkout.
    ...(payMethods.length
      ? [
          {
            icon: CreditCard,
            title: payMethods.map((m) => m.label).join(" & "),
            detail: hasKlarna() ? "Spread the cost" : "Pay your way",
          },
        ]
      : []),
  ];

  return (
    /*
     * One line, edge to edge.
     *
     * This began as six two-line cells inside a centred container, each boxed
     * off by a hairline. At 1440 that left roughly 168px of text per cell and
     * two of the six were truncating mid-word; the band also read as a strip of
     * badges competing with the full-bleed banner directly beneath it.
     *
     * Now each service is a single line — icon, title, supporting phrase — and
     * the row runs the full width with no container and no dividers, so the
     * The desktop row carries titles only. Six titles *and* six supporting
     * phrases need roughly 1850px before they stop colliding — and because the
     * items are nowrap there is no ellipsis to catch them, so below that they
     * overlap rather than truncate. Rather than hang the row off a brittle
     * breakpoint, each title is written to stand alone, with the delivery
     * threshold folded into its own label. The mobile ticker scrolls, so it
     * still carries the fuller phrasing.
     *
     * Set in the menu face so the header reads as one typeface rather than
     * three: Archivo standing in for Lusso's licensed ABC Diatype Extended,
     * same as the navigation above it. See layout.tsx.
     *
     * The 48px height is a contract, not a preference: `.page-top` in
     * globals.css and the homepage spacer both reserve a fixed header height
     * that counts this band, so it is pinned with `h-12` rather than left to
     * fall out of whatever the type sizes happen to add up to. For the same
     * reason it carries a top rule only — a bottom rule would spend a second
     * pixel the contract has not got, and the hero draws its own edge anyway.
     */
    <div className="border-t border-foreground/10 bg-background font-menu">
      {/* Below lg: continuous auto-scrolling ticker, not user-scrollable —
          the track holds two back-to-back copies of the items and slides
          left forever so it never needs a manual swipe. */}
      <div className="h-12 overflow-hidden lg:hidden">
        <div className="flex h-12 w-max animate-service-strip-marquee items-center gap-10">
          {[...items, ...items].map(({ icon: Icon, title, detail }, index) => (
            <div
              key={`${title}-${index}`}
              className="flex shrink-0 items-center gap-2"
            >
              <Icon
                className="h-4 w-4 shrink-0 text-foreground"
                strokeWidth={2}
              />
              <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
                {title}
              </span>
              <span className="whitespace-nowrap text-[11px] text-foreground/50">
                {detail}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* lg and up: one full-width row, spaced apart rather than divided up. */}
      <div className="hidden h-12 w-full items-center justify-between gap-5 px-6 lg:flex xl:gap-8 xl:px-10">
        {items.map(({ icon: Icon, title, short }) => (
          <div key={title} className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2} />
            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
              {short ?? title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

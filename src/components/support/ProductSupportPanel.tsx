"use client";

import Link from "next/link";
import { MessageCircle, Phone, Mail } from "lucide-react";
import { openSupportChat } from "@/components/support/supportChatBus";

/**
 * "Need help with this product?" — Chat / Call / Email, shown under the buy
 * box on every product page.
 *
 * Purely additive: it sits below the existing Add to Basket / calculator /
 * enquiry controls and changes none of them. Tiles, flooring, bathrooms,
 * radiators and technical lines are where customers most often want advice
 * before ordering, which is why it lives on the product page rather than only
 * in the header.
 */
export function ProductSupportPanel({
  phone,
  phoneHref,
  email,
  hours,
  productName,
  productCode,
}: {
  phone: string;
  phoneHref: string;
  email: string;
  hours?: string;
  productName?: string;
  productCode?: string;
}) {
  // Pre-fill the email so neither the customer nor the team retypes the SKU.
  const subject = productName
    ? `Product question — ${productName}`
    : "Product question";
  const body = [
    "Hello,",
    "",
    productName ? `I have a question about: ${productName}` : "",
    productCode ? `Product code: ${productCode}` : "",
    "",
    "My question:",
  ]
    .filter(Boolean)
    .join("\n");
  const mailto = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const itemClass =
    "flex-1 inline-flex items-center justify-center gap-2 px-3 py-3 border border-foreground/15 text-[12px] font-bold uppercase tracking-[0.12em] hover:bg-foreground hover:text-background transition-colors";

  return (
    <div className="rounded-xl border border-foreground/10 bg-white p-5">
      <p className="text-sm font-bold">Need help with this product?</p>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        Our team can advise on specification, quantities and delivery
        {hours ? ` — ${hours}` : ""}.
      </p>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() =>
            openSupportChat({
              productName,
              productCode,
            })
          }
          className={itemClass}
        >
          <MessageCircle className="w-4 h-4" />
          Live chat
        </button>

        <a href={phoneHref || undefined} className={itemClass}>
          <Phone className="w-4 h-4" />
          {phone}
        </a>

        <a href={mailto} className={itemClass}>
          <Mail className="w-4 h-4" />
          Email us
        </a>
      </div>

      <Link
        href="/help"
        className="mt-3 inline-block text-[11px] uppercase tracking-[0.16em] font-bold underline underline-offset-4 text-foreground/70 hover:text-foreground"
      >
        Visit the Help Centre
      </Link>
    </div>
  );
}

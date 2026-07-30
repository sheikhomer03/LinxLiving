"use client";

import { MessageCircle, Mail, Globe, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  mailtoHref,
  telHref,
  websiteHref,
  whatsappHref,
  type SupplierContact,
} from "@/lib/supplierContact";

type Props = {
  supplier: SupplierContact;
  /** Optional product context for prefilled WhatsApp/email */
  productName?: string;
  className?: string;
  size?: "sm" | "md";
  showLabels?: boolean;
};

export function SupplierContactButtons({
  supplier,
  productName,
  className,
  size = "md",
  showLabels = true,
}: Props) {
  const wa = whatsappHref(
    supplier.whatsapp || supplier.phone,
    productName
      ? `Hi, I'm enquiring about ${productName} from Linx Living.`
      : undefined,
  );
  const mail = mailtoHref(supplier.email, {
    subject: productName
      ? `Enquiry: ${productName} — Linx Living`
      : `Enquiry — ${supplier.name}`,
    body: productName
      ? `Hi,\n\nI'd like to enquire about ${productName}.\n\n`
      : undefined,
  });
  const web = websiteHref(supplier.website);
  const phone = telHref(supplier.phone);

  const btn =
    size === "sm"
      ? "h-8 px-2.5 text-[9px] gap-1.5"
      : "h-10 px-3 text-[10px] gap-2";

  const items = [
    {
      key: "whatsapp",
      href: wa,
      label: "WhatsApp",
      icon: MessageCircle,
      className:
        "border-emerald-600/30 text-emerald-800 hover:bg-emerald-50 hover:border-emerald-600/50",
    },
    {
      key: "email",
      href: mail,
      label: "Email",
      icon: Mail,
      className:
        "border-sky-600/30 text-sky-800 hover:bg-sky-50 hover:border-sky-600/50",
    },
    {
      key: "website",
      href: web,
      label: "Website",
      icon: Globe,
      className:
        "border-stone-400/40 text-stone-800 hover:bg-stone-50 hover:border-stone-500/50",
    },
    {
      key: "phone",
      href: phone,
      label: "Call",
      icon: Phone,
      className:
        "border-amber-600/30 text-amber-900 hover:bg-amber-50 hover:border-amber-600/50",
    },
  ].filter((i) => i.href);

  if (!items.length) {
    return (
      <p className="text-[10px] uppercase tracking-widest text-stone-400 font-bold">
        No contact details
      </p>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <a
            key={item.key}
            href={item.href!}
            target={item.key === "website" || item.key === "whatsapp" ? "_blank" : undefined}
            rel={
              item.key === "website" || item.key === "whatsapp"
                ? "noopener noreferrer"
                : undefined
            }
            className={cn(
              "inline-flex items-center justify-center rounded-md border font-bold uppercase tracking-[0.12em] transition-colors",
              btn,
              item.className,
            )}
          >
            <Icon className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
            {showLabels ? <span>{item.label}</span> : null}
          </a>
        );
      })}
    </div>
  );
}

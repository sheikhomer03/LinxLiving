"use client";

import { MessageCircle, Phone, Mail } from "lucide-react";
import { openSupportChat } from "@/components/support/supportChatBus";

/**
 * The three contact routes at the top of the Help Centre.
 *
 * Client-side only because "Start live chat" opens the floating launcher
 * through the support event bus; the rest of the page stays a server
 * component.
 */
export function HelpContactButtons({
  phone,
  phoneHref,
  email,
  hours,
}: {
  phone: string;
  phoneHref: string;
  email: string;
  hours?: string;
}) {
  const card =
    "flex-1 min-w-[220px] border border-foreground/12 p-6 text-center hover:border-foreground/30 transition-colors";

  return (
    <div className="mt-9 flex flex-wrap justify-center gap-4">
      <button
        type="button"
        onClick={() => openSupportChat({ topic: "" })}
        className={card}
      >
        <MessageCircle className="w-6 h-6 mx-auto text-primary" strokeWidth={1.5} />
        <p className="mt-3 text-[13px] font-bold uppercase tracking-[0.14em]">
          Live chat
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Quickest way to get an answer
        </p>
      </button>

      <a href={phoneHref || undefined} className={card}>
        <Phone className="w-6 h-6 mx-auto text-primary" strokeWidth={1.5} />
        <p className="mt-3 text-[13px] font-bold uppercase tracking-[0.14em]">
          {phone}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {hours || "Speak to the team"}
        </p>
      </a>

      <a href={`mailto:${email}`} className={card}>
        <Mail className="w-6 h-6 mx-auto text-primary" strokeWidth={1.5} />
        <p className="mt-3 text-[13px] font-bold uppercase tracking-[0.14em]">
          Email us
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{email}</p>
      </a>
    </div>
  );
}

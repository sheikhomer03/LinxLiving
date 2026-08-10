"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ruler, PhoneCall } from "lucide-react";
import { submitInquiry } from "@/app/actions/contact";

/**
 * Made-to-measure configurator → enquiry.
 *
 * Bespoke ranges (windows, doors, front doors, pergolas, awnings) are never
 * sold online: the customer configures their size and options, we take it as a
 * lead, then call them and price it. There is deliberately no price, no basket
 * and no checkout anywhere in this component.
 */
export function MadeToMeasureEnquiry({
  productId,
  productName,
  brandName,
}: {
  productId: string;
  productName: string;
  brandName?: string;
}) {
  const [widthMm, setWidthMm] = useState("");
  const [heightMm, setHeightMm] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error("Please add your name, email and phone number");
      return;
    }
    if (!widthMm.trim() || !heightMm.trim()) {
      toast.error("Please enter the width and height you need");
      return;
    }
    if (!consent) {
      toast.error("Please agree to us storing your details so we can reply");
      return;
    }

    setSending(true);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("email", email.trim());
      fd.set("phone", phone.trim());
      fd.set("subject", `Made-to-measure enquiry — ${productName}`);
      fd.set(
        "message",
        [
          "Made-to-measure configuration submitted from the product page.",
          "",
          `Product  : ${productName}`,
          // Supplier omitted — the customer sees this text. The product code
          // below identifies the line for the team.
          null,
          `Ref      : ${productId}`,
          "",
          `Width    : ${widthMm.trim()} mm`,
          `Height   : ${heightMm.trim()} mm`,
          `Quantity : ${quantity.trim() || "1"}`,
          notes.trim() ? `\nNotes:\n${notes.trim()}` : null,
          "",
          "Customer is expecting a call back with a price.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      fd.set("consent", "on");

      const result = await submitInquiry(fd);
      if (result?.success === false) {
        toast.error(result.error || "Could not send your enquiry");
        return;
      }
      setSent(true);
      toast.success("Enquiry sent — we'll call you with a price");
    } catch {
      toast.error("Could not send your enquiry. Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-xl border border-foreground/10 bg-[#f7f5f2] p-5 flex items-start gap-3">
        <PhoneCall className="w-5 h-5 mt-0.5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-bold">Enquiry received</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Our team will call you to confirm the specification for{" "}
            {productName} and give you a price.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-white p-5 space-y-4">
      <div className="flex items-start gap-2.5">
        <Ruler className="w-4 h-4 mt-0.5 text-primary shrink-0" />
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.12em]">
            Made to measure
          </h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            This product is built to your sizes, so it isn&apos;t sold online.
            Enter your measurements and we&apos;ll call you with a price.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="relative block">
            <span className="sr-only">Width in millimetres</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={widthMm}
              onChange={(e) => setWidthMm(e.target.value)}
              placeholder="Width"
              className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              mm
            </span>
          </label>
          <label className="relative block">
            <span className="sr-only">Height in millimetres</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={heightMm}
              onChange={(e) => setHeightMm(e.target.value)}
              placeholder="Height"
              className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              mm
            </span>
          </label>
        </div>

        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Quantity"
          className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
        />

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Finish, colour, glazing or fitting notes (optional)"
          className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 resize-none"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            autoComplete="tel"
            className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          autoComplete="email"
          className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
        />

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-foreground"
          />
          <span className="text-[11px] text-muted-foreground leading-relaxed">
            I agree to Linx Square storing these details in order to reply.
          </span>
        </label>

        <button
          type="submit"
          disabled={sending}
          className="w-full h-12 inline-flex items-center justify-center gap-2 text-base font-bold bg-foreground text-background hover:bg-foreground/90 rounded-xl transition-colors disabled:opacity-50"
        >
          <PhoneCall className="w-4 h-4" />
          {sending ? "Sending…" : "Request a price"}
        </button>
      </form>
    </div>
  );
}

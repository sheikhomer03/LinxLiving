"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { submitInquiry } from "@/app/actions/contact";

/**
 * Free sample request — deliberately separate from Add to Cart.
 *
 * Samples are not a purchase: no price, no basket, no checkout. The request is
 * routed through the existing contact-query pipeline so it lands in the admin
 * Queries inbox alongside other enquiries, tagged with the product it came from.
 */
export function ProductSampleRequest({
  productId,
  productName,
  brandName,
}: {
  productId: string;
  productName: string;
  brandName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !address.trim()) {
      toast.error("Please add your name, email and delivery address");
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
      fd.set("subject", `Free sample request — ${productName}`);
      fd.set(
        "message",
        [
          `Free sample requested from the product page.`,
          ``,
          `Product : ${productName}`,
          // Supplier omitted — the customer sees this text. The product code
          // below identifies the line for the team.
          null,
          `Ref     : ${productId}`,
          ``,
          `Deliver to:`,
          address.trim(),
        ]
          .filter(Boolean)
          .join("\n"),
      );
      fd.set("consent", "on");

      const result = await submitInquiry(fd);
      if (result?.success === false) {
        toast.error(result.error || "Could not send your request");
        return;
      }
      setSent(true);
      toast.success("Sample request sent — we'll be in touch shortly");
    } catch {
      toast.error("Could not send your request. Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-xl border border-foreground/10 bg-[#f7f5f2] p-5 flex items-start gap-3">
        <PackageCheck className="w-5 h-5 mt-0.5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-bold">Sample request received</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            We&apos;ll confirm your free sample of {productName} by email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-secondary/40 transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <PackageCheck className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold uppercase tracking-[0.12em]">
            Add a free sample
          </span>
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 transition-transform shrink-0",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Order a free sample before you commit. No payment needed — this is a
            request, not a purchase, and won&apos;t be added to your basket.
          </p>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            autoComplete="email"
            className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Delivery address"
            rows={3}
            autoComplete="street-address"
            className="w-full rounded-lg border border-foreground/15 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 resize-none"
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
            className="w-full h-11 inline-flex items-center justify-center gap-2 text-sm font-bold border border-foreground/20 rounded-xl hover:bg-foreground hover:text-background transition-colors disabled:opacity-50"
          >
            {sending ? "Sending…" : "Request free sample"}
          </button>
        </form>
      )}
    </div>
  );
}

"use client";

import { X, AlertTriangle, Phone, RotateCw } from "lucide-react";
import Link from "next/link";

/**
 * Shown when Shopify hosted checkout cannot be reached.
 *
 * Deliberately a dead end rather than a fallback: payment lives on Shopify, so
 * quietly completing the order through the site's own checkout would take an
 * order Shopify never sees — no payment captured, no inventory movement, and
 * an order record that disagrees with the store. Telling the customer to come
 * back or call is the honest outcome, and their basket is left intact.
 */
export function CheckoutUnavailableModal({
  open,
  onClose,
  onRetry,
  detail,
}: {
  open: boolean;
  onClose: () => void;
  onRetry?: () => void;
  /** Underlying error, for the customer to quote when they call. */
  detail?: string | null;
}) {
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="checkout-unavailable-title"
      className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-8 md:p-12 text-center space-y-8">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-secondary flex items-center justify-center rounded-full">
              <AlertTriangle className="w-8 h-8 opacity-90" />
            </div>
          </div>

          <div className="space-y-3">
            <h2
              id="checkout-unavailable-title"
              className="text-2xl font-serif tracking-widest uppercase text-[#333]"
            >
              Checkout Unavailable
            </h2>
            <p className="text-sm text-foreground/60 leading-relaxed font-sans">
              We can&rsquo;t reach our secure payment provider at the moment, so
              your order cannot be completed right now. Your basket has been
              saved &mdash; please try again shortly or contact our team and
              we&rsquo;ll place the order for you.
            </p>
            {detail ? (
              <p className="text-[11px] text-foreground/40 font-sans pt-1 break-words">
                {detail}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 pt-4">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center justify-center gap-3 px-8 py-4 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-all group shadow-lg shadow-black/5"
              >
                <RotateCw className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                Try again
              </button>
            ) : null}
            <Link
              href="/contact"
              onClick={onClose}
              className="flex items-center justify-center gap-3 px-8 py-4 border border-primary/15 uppercase tracking-widest text-[11px] font-bold hover:bg-secondary transition-colors"
            >
              <Phone className="w-4 h-4" />
              Contact our team
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

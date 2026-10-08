"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { VisualiserCalculator } from "@/components/visualiser/VisualiserCalculator";
import type { CalculatorProduct } from "@/lib/visualiser/calculatorProduct";

/** Pricing data already fetched this visit, by product id (fresh for 3 min). */
const cache = new Map<string, { at: number; product: CalculatorProduct }>();
const CACHE_MS = 180_000;

/**
 * "Calculate quantity" for the design on the floor: the product page's
 * calculator in a drawer — from the right on desktop, from the bottom on
 * phones — loaded the moment it opens.
 */
export function CalculatorDrawer({
  productId,
  productName,
  scannedAreaM2,
  surfaceLabel,
  onClose,
}: {
  productId: string;
  productName: string;
  scannedAreaM2: number | null;
  /** The surface the design is on ("Floor", "Back Wall 2"), for the area hint. */
  surfaceLabel?: string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; product: CalculatorProduct } | { status: "error"; message: string }
  >(() => {
    const hit = cache.get(productId);
    return hit && Date.now() - hit.at < CACHE_MS ? { status: "ready", product: hit.product } : { status: "loading" };
  });
  const [attempt, setAttempt] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const hit = cache.get(productId);
    if (hit && Date.now() - hit.at < CACHE_MS) return;
    const controller = new AbortController();
    fetch(`/api/visualiser/product/${encodeURIComponent(productId)}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.product) throw new Error(json?.error || "Could not load this product.");
        cache.set(productId, { at: Date.now(), product: json.product });
        setState({ status: "ready", product: json.product });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: e instanceof Error ? e.message : "Could not load this product." });
      });
    return () => controller.abort();
  }, [productId, attempt]);

  // Esc closes; the page behind does not scroll while the drawer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-70" style={{ colorScheme: "light" }}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vis-calc-title"
        className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-xl bg-white text-black shadow-2xl min-[900px]:inset-y-0 min-[900px]:left-auto min-[900px]:right-0 min-[900px]:max-h-none min-[900px]:w-115 min-[900px]:rounded-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/10 px-4 py-3">
          <div className="min-w-0">
            <h2 id="vis-calc-title" className="font-menu text-[12px] font-medium uppercase tracking-[1.2px]">
              Calculate quantity
            </h2>
            <p className="truncate text-xs text-black/60">{productName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-4">
          {state.status === "loading" ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-black/50" />
            </div>
          ) : state.status === "error" ? (
            <div role="alert" className="space-y-3 py-8 text-center">
              <AlertCircle className="mx-auto h-6 w-6 text-[#D3102F]" />
              <p className="text-sm text-black/70">{state.message}</p>
              <button
                type="button"
                onClick={() => {
                  setState({ status: "loading" });
                  setAttempt((n) => n + 1);
                }}
                className="text-sm font-semibold underline"
              >
                Try again
              </button>
            </div>
          ) : (
            <VisualiserCalculator
              key={state.product.id}
              product={state.product}
              scannedAreaM2={scannedAreaM2}
              surfaceLabel={surfaceLabel ?? null}
              onAdded={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

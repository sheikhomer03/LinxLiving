"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Calculator } from "lucide-react";
import { CalculatorDrawer } from "@/components/visualiser/CalculatorDrawer";
import { useVisualiser } from "@/components/visualiser/VisualiserContext";
import { selectActiveFloor, selectCurrentDesign } from "@/store/useVisualiserStore";

/**
 * The side panel's footer: the design on the floor being edited, and the
 * product page's quantity calculator and Add to cart for it.
 */
export function FloorPanel() {
  const item = useVisualiser(selectCurrentDesign);
  const floor = useVisualiser(selectActiveFloor);
  const areaM2 = useVisualiser((s) => s.areaM2);
  const [calcOpen, setCalcOpen] = useState(false);
  const closeCalc = useCallback(() => setCalcOpen(false), []);
  const step = useVisualiser((s) => s.step);
  const { design, card } = item;
  const isSheet = design.material === "carpet";
  const size = floor?.tileSize ?? design.sizeMm;

  return (
    <div className="shrink-0 space-y-3 border-t border-black/10 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={design.thumb} alt="" className="h-10 w-10 shrink-0 rounded-sm bg-[#f3f3f1] object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-black" title={design.name}>
            {design.name}
          </p>
          <p className="truncate text-[11px] text-black/55">
            {card.brandName ? `${card.brandName} · ` : ""}
            {isSheet ? "Carpet" : `${size.w} × ${size.h} mm`}
          </p>
        </div>
        <Link
          href={`/products/${card.id}`}
          className="shrink-0 text-[11px] font-medium text-black underline underline-offset-2"
        >
          Details
        </Link>
      </div>

      {/* The product page's own calculator, for this design. */}
      <div className="flex items-center gap-2 max-[899px]:pr-12">
        <button
          type="button"
          onClick={() => setCalcOpen(true)}
          className="font-menu inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-sm bg-black px-3 text-[11px] font-medium uppercase tracking-[0.6px] text-white transition-opacity hover:opacity-90"
        >
          <Calculator className="h-4 w-4 shrink-0" />
          <span className="truncate">Calculate &amp; add to cart</span>
        </button>
      </div>

      {calcOpen ? (
        <CalculatorDrawer
          productId={card.id}
          productName={design.name}
          scannedAreaM2={step === "visualise" ? areaM2 : null}
          onClose={closeCalc}
        />
      ) : null}
    </div>
  );
}

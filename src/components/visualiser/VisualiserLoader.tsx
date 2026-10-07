"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { VisualiserDesignCard, VisualiserDesignsResponse } from "@/lib/visualiser/types";

/**
 * WebGL and three.js only exist in the browser, and only this page needs
 * them: loading the app here, without SSR, keeps them out of every other
 * page's bundle.
 */
const VisualiserApp = dynamic(() => import("@/components/visualiser/VisualiserApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100dvh-var(--lx-announce-h)-var(--lx-header-h))] min-h-140 items-center justify-center border-t border-black/10 bg-[#f3f3f1]">
      <Loader2 className="h-7 w-7 animate-spin text-black/40" />
    </div>
  ),
});

export function VisualiserLoader(props: {
  initialDesign: VisualiserDesignCard;
  initialDesigns: VisualiserDesignsResponse;
}) {
  return <VisualiserApp {...props} />;
}

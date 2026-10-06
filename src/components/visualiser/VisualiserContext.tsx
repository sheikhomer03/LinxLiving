"use client";

import { createContext, useContext } from "react";
import type { VisualiserStore } from "@/store/useVisualiserStore";

/** The page's own visualiser store (one per visit, never shared or persisted). */
export const VisualiserContext = createContext<VisualiserStore | null>(null);

export function useVisualiser<T>(
  selector: (s: ReturnType<VisualiserStore["getState"]>) => T,
): T {
  const store = useContext(VisualiserContext);
  if (!store) throw new Error("useVisualiser must be used inside <VisualiserApp>");
  return store(selector);
}

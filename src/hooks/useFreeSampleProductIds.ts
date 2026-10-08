"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getFreeSampleProductIds } from "@/app/actions/products";

/*
 * Which basket products come with a free sample, as the server decides it
 * (see lib/freeSampleServer). Answers are kept for the tab, per product, so
 * the cart drawer and the checkout summary share one lookup and a product is
 * asked about once — whether a product has a free sample does not change
 * while someone shops.
 */
const known = new Map<string, boolean>();
const asking = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const snapshot = () => version;
const serverSnapshot = () => 0;

function settle(ids: string[], withSample: string[]) {
  const yes = new Set(withSample);
  for (const id of ids) {
    known.set(id, yes.has(id));
    asking.delete(id);
  }
  version++;
  for (const listener of listeners) listener();
}

export function useFreeSampleProductIds(
  productIds: readonly (string | null | undefined)[],
): ReadonlySet<string> {
  const key = [...new Set(productIds.filter((id): id is string => !!id))]
    .sort()
    .join("|");
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    const missing = ids.filter((id) => !known.has(id) && !asking.has(id));
    if (!missing.length) return;
    for (const id of missing) asking.add(id);
    getFreeSampleProductIds(missing)
      .then((withSample) => settle(missing, withSample))
      // Not answered: no sample line rather than a guess. Asked again on the
      // next change to the basket.
      .catch(() => {
        for (const id of missing) asking.delete(id);
      });
  }, [key]);

  return useMemo(
    () => new Set(key ? key.split("|").filter((id) => known.get(id)) : []),
    // `current` changes when an answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, current],
  );
}

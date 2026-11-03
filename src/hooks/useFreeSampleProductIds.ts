"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getFreeSampleProductIds } from "@/app/actions/products";

/*
 * Which basket products come with a free sample (see lib/freeSampleServer).
 *
 * Two kinds of answer, kept for the tab per product:
 *   - `known`: the server's verdict — from the cart's own lookup, or handed
 *     over by a page that already worked it out with the same rule (the
 *     product page, the visualiser). Final. Kept in sessionStorage so a
 *     refresh or a reopened cart shows the sample at once.
 *   - `guessed`: a product card's quick answer from what it has on screen,
 *     so the sample row shows the moment the card adds the product. The
 *     server is still asked, and its answer replaces the guess.
 *
 * Checkout never reads any of this: it decides again from Mongo.
 */
const known = new Map<string, boolean>();
const guessed = new Map<string, boolean>();
const asking = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const STORAGE_KEY = "linx:free-sample";
let restored = false;

/** Answers this tab already had, from before a refresh. */
function restore() {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "{}");
    for (const [id, value] of Object.entries(saved)) {
      if (typeof value === "boolean" && !known.has(id)) known.set(id, value);
    }
  } catch {
    // Storage blocked or unreadable: the server answers instead.
  }
}

function persist() {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(known)),
    );
  } catch {
    // Storage blocked or full: answers still hold for this page.
  }
}

function notify() {
  version++;
  for (const listener of listeners) listener();
}

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
    guessed.delete(id);
    asking.delete(id);
  }
  persist();
  notify();
}

/**
 * Hand the cart the answer for a product before it is added, so its sample
 * row shows in the same moment as the product.
 *
 * `confirmed`: worked out on the server with the checkout's own rule (the
 * product page, the visualiser) — final. Otherwise a card's guess, which the
 * server will confirm or correct.
 */
export function primeFreeSample(
  productId: string,
  hasSample: boolean | null | undefined,
  confirmed = false,
) {
  if (!productId || typeof hasSample !== "boolean") return;
  restore();
  if (confirmed) {
    if (known.get(productId) === hasSample) return;
    known.set(productId, hasSample);
    guessed.delete(productId);
    persist();
  } else {
    if (known.has(productId) || guessed.get(productId) === hasSample) return;
    guessed.set(productId, hasSample);
  }
  notify();
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
      // Not answered: keep any guess, and ask again on the next change to
      // the basket.
      .catch(() => {
        for (const id of missing) asking.delete(id);
      });
  }, [key]);

  return useMemo(() => {
    // `current` changes whenever an answer arrives or is handed over.
    void current;
    // Once per tab, in the browser: answers from before a refresh, so the
    // first paint already shows them.
    restore();
    const ids = key ? key.split("|") : [];
    return new Set(
      ids.filter((id) =>
        known.has(id) ? known.get(id) === true : guessed.get(id) === true,
      ),
    );
  }, [key, current]);
}

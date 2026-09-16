"use client";

import { useEffect, useState } from "react";
import {
  ProductCarousel,
  type CarouselProduct,
} from "@/components/products/ProductCarousel";

/**
 * The "RECENTLY VIEWED" strip, last of the four the reference runs.
 *
 * On /products/romano-fluted-travertine-stone-mosaic-wall-tile it is a
 * `<recently-viewed>` element with `data-max_cards_to_output="8"` and
 * `data-columns_desktop="4"` — the same carousel as the three above it,
 * filled from the visitor's own history rather than from a query, and
 * absent entirely for someone who has not looked at anything else yet.
 *
 * The history lives in this browser only. It is written on every product
 * page view and never leaves the device, so nothing here needs a round trip
 * or an account.
 */

const STORAGE_KEY = "recently-viewed-products";
const MAX_STORED = 12;

/** Only what a card needs — a full product would blow the storage budget. */
type StoredProduct = CarouselProduct & { _viewedAt: number };

function readHistory(): StoredProduct[] {
  // Private windows, cleared site data and blocked storage all throw here
  // rather than returning empty, so every read is guarded.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function RecentlyViewed({
  current,
  inColumn = false,
}: {
  current: CarouselProduct;
  /** Passed through — see ProductCarousel. */
  inColumn?: boolean;
}) {
  const [others, setOthers] = useState<CarouselProduct[]>([]);

  useEffect(() => {
    const history = readHistory().filter(
      (item) => item && item._id && item._id !== current._id,
    );

    // What to show is everything *except* this product — recording the
    // current one first would put the page you are on at the head of its own
    // strip.
    setOthers(history.slice(0, 8));

    try {
      const next = [
        { ...current, _viewedAt: Date.now() },
        ...history,
      ].slice(0, MAX_STORED);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the strip simply stays empty next time.
    }
  }, [current]);

  // Nothing seen yet: no heading, no empty rule. The reference's own
  // section renders nothing for a first-time visitor for the same reason.
  return (
    <ProductCarousel
      title="Recently viewed"
      inColumn={inColumn}
      products={others}
    />
  );
}

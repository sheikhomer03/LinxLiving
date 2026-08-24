"use client";

import { useCallback, useState } from "react";

/**
 * How much of an image `object-cover` may crop before showing all of it wins.
 *
 * Measured across the 111,527 product images on Cloudinary: three quarters are
 * square and lose nothing to cover, but roughly a quarter lose a fifth or more,
 * and 1,559 lose over half — Porcelanosa's dimension drawings run to 2575x171,
 * where cover leaves a 7% sliver of an unreadable diagram. Past this point the
 * picture stops being a crop and starts being the wrong picture.
 */
export const MAX_COVER_CROP = 0.2;

type Fit = "cover" | "contain";

/** The share of the longer edge cover would cut off in a square box. */
export function cropLoss(width: number, height: number) {
  if (!width || !height) return 0;
  return 1 - Math.min(width, height) / Math.max(width, height);
}

/**
 * Pick `object-cover` or `object-contain` from the image's real proportions.
 *
 * The choice cannot be made before the image loads: the stored URL carries no
 * dimensions — Shopify's `width=` is a request, not a description — so the
 * natural size is read on load and the class settles then. Cover is the
 * starting guess because it is right for three quarters of the catalogue, so
 * most images never change class at all.
 */
export function useImageFit(initial: Fit = "cover") {
  const [fit, setFit] = useState<Fit>(initial);

  const onLoad = useCallback(
    (event: { currentTarget?: HTMLImageElement | null; target?: EventTarget | null }) => {
      const img = (event.currentTarget ?? event.target) as HTMLImageElement | null;
      const width = img?.naturalWidth ?? 0;
      const height = img?.naturalHeight ?? 0;
      if (!width || !height) return;
      setFit(cropLoss(width, height) > MAX_COVER_CROP ? "contain" : "cover");
    },
    [],
  );

  return {
    fit,
    onLoad,
    /** Ready to drop into a className; `object-center` only matters to cover. */
    fitClass: fit === "cover" ? "object-cover object-center" : "object-contain",
  };
}

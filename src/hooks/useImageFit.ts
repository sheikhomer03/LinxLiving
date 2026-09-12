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

/**
 * The share of the image `object-cover` would cut off in a box of `boxAspect`.
 *
 * `boxAspect` is width ÷ height and defaults to 1, the square tile most of the
 * site draws. It matters because the loss is a comparison, not a property of
 * the image: a 3:2 photograph loses a third of itself to a square tile and
 * nothing at all to a 3:2 stage. A caller whose box follows its content has to
 * say so, or every wide photograph is judged against a square it is no longer
 * being shown in.
 */
export function cropLoss(width: number, height: number, boxAspect = 1) {
  if (!width || !height || !boxAspect) return 0;
  const image = width / height;
  return 1 - Math.min(image, boxAspect) / Math.max(image, boxAspect);
}

/**
 * Pick `object-cover` or `object-contain` from the image's real proportions.
 *
 * `maxCrop` lets a caller move the line. The PDP takes the default, because a
 * product page should show a picture whole. A card is a grid cell and wants to
 * be filled, so it passes a far looser figure and only gives up on cropping
 * where the crop would take most of the subject with it.
 *
 * The choice cannot be made before the image loads: the stored URL carries no
 * dimensions — Shopify's `width=` is a request, not a description — so the
 * natural size is read on load and the class settles then. Cover is the
 * starting guess because it is right for three quarters of the catalogue, so
 * most images never change class at all.
 */
export function useImageFit(
  initial: Fit = "cover",
  maxCrop = MAX_COVER_CROP,
  boxAspect = 1,
) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const onLoad = useCallback(
    (event: { currentTarget?: HTMLImageElement | null; target?: EventTarget | null }) => {
      const img = (event.currentTarget ?? event.target) as HTMLImageElement | null;
      const width = img?.naturalWidth ?? 0;
      const height = img?.naturalHeight ?? 0;
      if (!width || !height) return;
      setSize({ width, height });
    },
    [],
  );

  // Derived rather than stored, because `boxAspect` can settle after the image
  // has loaded — a stage that takes its shape from this very picture reports
  // its aspect on the same load. Recomputing keeps the two in step, where a
  // `fit` frozen at load time would judge the image against the box it just
  // replaced and letterbox a photograph inside a stage cut to match it.
  const fit: Fit = size
    ? cropLoss(size.width, size.height, boxAspect) > maxCrop
      ? "contain"
      : "cover"
    : initial;

  return {
    fit,
    onLoad,
    /** Natural pixel size once the image has loaded, for callers sizing a box. */
    naturalSize: size,
    /** Ready to drop into a className; `object-center` only matters to cover. */
    fitClass: fit === "cover" ? "object-cover object-center" : "object-contain",
  };
}

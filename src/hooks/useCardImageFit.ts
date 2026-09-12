"use client";

import { useEffect, useState } from "react";

/**
 * Decide how a card tile should show a product image, by looking at the image.
 *
 * A card is square above the mobile breakpoint and the catalogue's artwork is
 * not, so something has to give. Which thing depends entirely on what kind of
 * picture it is, and proportions do not tell you:
 *
 *  - A **packshot** is a product floating on a plain backdrop. Cropping it to
 *    the tile cuts the product up — the RAK-Moon riser kit is 824x2000 and a
 *    square crop keeps 41% of its height, discarding the head, rail and valve;
 *    the Adjustable Handset Bracket is 1.73:1 with the bracket spanning 1886 of
 *    2000px, so a centre crop slices straight through it. These have to be
 *    shown whole.
 *  - A **photograph** — a room, an elevation, a floor — runs to the edges.
 *    Showing it whole puts white bands down two sides of the tile, which is
 *    what made the FAKRO and Schüco rows look broken. These want cropping;
 *    a crop of a scene is just a reframing.
 *
 * A packshot is recognised by its border: sample the edge pixels and most of
 * them are the backdrop. Two details matter, and the obvious version of the
 * test gets both wrong.
 *
 * It has to be robust rather than absolute. Comparing the darkest edge pixel
 * against the lightest called every chrome fitting a photograph — the slide
 * rails run off the top of the frame and the hoses cross a corner, so a
 * handful of edge pixels are product. One of those is enough to wreck a
 * min/max test while leaving the picture obviously a packshot. Taking the
 * median instead and asking what share of the edge sits near it survives a
 * product touching the border:
 *
 *      Square Slide Rail Kit      98% of the edge is backdrop  -> whole
 *      Round Handset Bracket Kit  97%                          -> whole
 *      Square Wall Outlet Elbow   82%                          -> whole
 *      FAKRO lifestyle, Schüco    15-16%                       -> crop
 *
 * And the backdrop has to be near-white. A tile or a floor fills the frame
 * with one material, so its edge is uniform too — Gambel Oak scores 95% and
 * Decorwall Lazurite 85%, and treating those as packshots would letterbox a
 * swatch that ought to fill the tile. What separates them is colour: every
 * packshot measured sits at rgb(255,255,255), while the textures are tinted,
 * rgb(186,158,125) and rgb(208,213,219). Checked against 60 products drawn at
 * random, the pair of tests put every fitting, basin and roof window on one
 * side and every floor, door and blind on the other.
 *
 * A backdrop is not always a colour. RAK's brassware ships as PNGs cut out on
 * transparency — 94-100% of their edge pixels have no alpha at all — and a
 * transparent pixel reads back from a canvas as rgb(0,0,0), so testing the
 * colour alone declared every one of them a photograph and cropped it. The
 * chrome ones showed it worst, because theirs are the tightly framed shots:
 * the 300mm Ceiling Arm is 414x1697 and a square tile keeps a quarter of it.
 * Transparency is therefore checked first, and counts as backdrop in its own
 * right.
 *
 * Where the backdrop is an opaque colour it is handed back, so the tile can be
 * painted to match and the margin disappears into the photograph instead of
 * reading as a bar. Where it is transparency there is nothing to match, and
 * the tile keeps its own tone — which is what the card has always shown behind
 * a cut-out.
 *
 * The analysis runs against a second, throwaway `Image` rather than the one on
 * screen. Adding `crossOrigin` to the visible element would change its request
 * and could stop it loading altogether; a separate load hits the browser cache
 * and, if the pixels cannot be read for any reason, simply leaves the default
 * in place. Shopify's CDN answers with `access-control-allow-origin: *`, so in
 * practice they can.
 */

type Fit = "cover" | "contain";

export interface CardImageFit {
  fit: Fit;
  /** The backdrop colour, when the image is a packshot; otherwise null. */
  background: string | null;
  fitClass: string;
}

/** How far an edge pixel may sit from the median and still count as backdrop. */
const BACKDROP_TOLERANCE = 14;
/**
 * Share of the edge that must be backdrop for the image to be a packshot.
 *
 * Deliberately loose, because plenty of packshots run the product right out to
 * the frame: an exploded bath-waste diagram and a 320mm bottle trap each leave
 * only about 70% of their edge as backdrop, and at 80% both were cropped in
 * half. Loosening it is safe for photographs — a room or an elevation fails on
 * the colour test above long before this one, their edges averaging a mid-tone
 * rgb(158,148,145) rather than white.
 *
 * What it does risk is a pale tile: white marble fills the frame with something
 * near-white, so it can read as a product on a white backdrop. Measured over
 * 120 products, one did — a 5018x3512 Statuario — and it gets shown whole with
 * a margin rather than filling the tile. That is the right way round to be
 * wrong: a tile with a margin still shows the whole tile, while a cropped
 * packshot hides the product being sold.
 */
const MIN_BACKDROP_SHARE = 0.55;
/** How light that backdrop must be, to tell a packshot from a tile or a floor. */
const MIN_BACKDROP_LEVEL = 240;
/** Below this alpha a pixel is backdrop whatever its colour channels say. */
const CLEAR_ALPHA = 16;
/** Working size for the sample. Big enough for an edge, small enough to be free. */
const SAMPLE = 48;

const COVER: CardImageFit = {
  fit: "cover",
  background: null,
  fitClass: "object-cover object-center",
};

function analyse(img: HTMLImageElement): CardImageFit {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return COVER;

  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    // Tainted canvas — the image is served without CORS. Keep the default.
    return COVER;
  }

  const at = (x: number, y: number) => {
    const i = (y * SAMPLE + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
  };

  const edge: (readonly [number, number, number, number])[] = [];
  for (let i = 0; i < SAMPLE; i++) {
    edge.push(at(i, 0), at(i, SAMPLE - 1), at(0, i), at(SAMPLE - 1, i));
  }

  // Cut out on transparency: backdrop, whatever the colour channels hold.
  const clear = edge.filter((px) => px[3] < CLEAR_ALPHA);
  if (clear.length / edge.length >= MIN_BACKDROP_SHARE) {
    return { fit: "contain", background: null, fitClass: "object-contain object-center" };
  }

  const opaque = edge.filter((px) => px[3] >= CLEAR_ALPHA);
  if (!opaque.length) return COVER;

  // Median per channel: the backdrop, unmoved by the few edge pixels that are
  // product where a rail or a hose runs out of the frame.
  const median = [0, 1, 2].map((channel) => {
    const values = opaque.map((px) => px[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });

  if (Math.min(...median) < MIN_BACKDROP_LEVEL) return COVER;

  // Transparent edges count towards the backdrop too, for a part-cut-out shot.
  const backdrop =
    clear.length +
    opaque.filter((px) =>
      median.every((m, c) => Math.abs(px[c] - m) <= BACKDROP_TOLERANCE),
    ).length;
  if (backdrop / edge.length < MIN_BACKDROP_SHARE) return COVER;

  const rgb = `rgb(${median[0]}, ${median[1]}, ${median[2]})`;
  return { fit: "contain", background: rgb, fitClass: "object-contain object-center" };
}

export function useCardImageFit(src: string): CardImageFit {
  /**
   * Keyed by the src it was measured from, so a card that swaps image — a
   * colour swatch being chosen — falls back to filling until the new one has
   * been read, without resetting state from inside the effect.
   */
  const [measured, setMeasured] = useState<{ src: string; fit: CardImageFit } | null>(null);

  useEffect(() => {
    if (!src || typeof window === "undefined") return;

    let cancelled = false;
    const probe = new window.Image();
    probe.crossOrigin = "anonymous";
    probe.decoding = "async";
    probe.onload = () => {
      if (cancelled) return;
      try {
        setMeasured({ src, fit: analyse(probe) });
      } catch {
        /* any failure leaves the tile filling, which is the safer default */
      }
    };
    // A CORS-blocked or missing image simply never resolves to `contain`.
    probe.onerror = () => {};
    probe.src = src;

    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [src]);

  return measured && measured.src === src ? measured.fit : COVER;
}

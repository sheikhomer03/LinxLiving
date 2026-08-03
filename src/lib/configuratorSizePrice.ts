/**
 * Runtime size → live price using a real catalogue product as the anchor.
 * No fake products — scales / interpolates from listed size + price.
 */

export type ParsedSizeMm = { widthMm: number; heightMm: number };

export type SizePricePoint = {
  widthMm: number;
  heightMm: number;
  price: number;
};

/** Parse "60x90", "100cm x 150cm", "1200×900" into millimetres. */
export function parseSizeToMm(raw: string | undefined | null): ParsedSizeMm | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/,/g, ".");
  const cmHint = /\bcm\b/.test(s);
  const mmHint = /\bmm\b/.test(s);
  const m = s.match(
    /(\d+(?:\.\d+)?)\s*(?:cm|mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:cm|mm)?/i,
  );
  if (!m) return null;
  let w = Number(m[1]);
  let h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  // Unit: explicit hint, else small numbers are usually cm (roof windows / Fakro)
  if (cmHint || (!mmHint && w <= 400 && h <= 400)) {
    w *= 10;
    h *= 10;
  }

  return { widthMm: Math.round(w), heightMm: Math.round(h) };
}

export function areaM2(widthMm: number, heightMm: number) {
  return (widthMm / 1000) * (heightMm / 1000);
}

export type CustomSizeQuote = {
  ok: boolean;
  error?: string;
  widthMm: number;
  heightMm: number;
  areaM2: number;
  /** Price for the size only (before finishes etc.) */
  price: number;
  /** Which catalogue point was used as the pricing anchor */
  anchorLabel?: string;
};

/**
 * Live price for a typed custom size.
 * Prefer area interpolation between real sibling SKUs when available;
 * otherwise scale from a single listed size/price.
 */
export function quoteCustomSizePrice(input: {
  widthMm: number;
  heightMm: number;
  /** Current / reference product */
  reference: SizePricePoint & { label?: string };
  /** Optional sibling size SKUs with real prices */
  points?: SizePricePoint[];
  minWidthMm?: number;
  maxWidthMm?: number;
  minHeightMm?: number;
  maxHeightMm?: number;
}): CustomSizeQuote {
  const w = Math.round(Number(input.widthMm) || 0);
  const h = Math.round(Number(input.heightMm) || 0);
  const fail = (error: string): CustomSizeQuote => ({
    ok: false,
    error,
    widthMm: w,
    heightMm: h,
    areaM2: 0,
    price: 0,
  });

  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return fail("Enter width and height in mm");
  }

  const minW = input.minWidthMm ?? Math.max(200, Math.round(input.reference.widthMm * 0.4));
  const maxW = input.maxWidthMm ?? Math.round(input.reference.widthMm * 2.5);
  const minH = input.minHeightMm ?? Math.max(200, Math.round(input.reference.heightMm * 0.4));
  const maxH = input.maxHeightMm ?? Math.round(input.reference.heightMm * 2.5);

  if (w < minW || w > maxW) {
    return fail(`Width must be between ${minW} and ${maxW} mm`);
  }
  if (h < minH || h > maxH) {
    return fail(`Height must be between ${minH} and ${maxH} mm`);
  }

  const targetArea = areaM2(w, h);
  const points = [
    input.reference,
    ...(input.points || []).filter(
      (p) =>
        p.widthMm > 0 &&
        p.heightMm > 0 &&
        Number.isFinite(p.price) &&
        p.price > 0,
    ),
  ];

  // Dedupe by rounded area
  const byArea = new Map<number, SizePricePoint>();
  for (const p of points) {
    const a = Math.round(areaM2(p.widthMm, p.heightMm) * 1e6) / 1e6;
    if (!byArea.has(a)) byArea.set(a, p);
  }
  const sorted = [...byArea.entries()]
    .map(([a, p]) => ({ area: a, ...p }))
    .sort((a, b) => a.area - b.area);

  let price = 0;
  let anchorLabel = input.reference.label || "listed size";

  if (sorted.length >= 2) {
    const exact = sorted.find(
      (p) =>
        Math.abs(p.widthMm - w) <= 1 && Math.abs(p.heightMm - h) <= 1,
    );
    if (exact) {
      price = exact.price;
      anchorLabel = `${exact.widthMm}×${exact.heightMm} mm SKU`;
    } else if (targetArea <= sorted[0].area) {
      const p = sorted[0];
      price = p.price * (targetArea / p.area);
      anchorLabel = `scaled from ${p.widthMm}×${p.heightMm} mm`;
    } else if (targetArea >= sorted[sorted.length - 1].area) {
      const p = sorted[sorted.length - 1];
      price = p.price * (targetArea / p.area);
      anchorLabel = `scaled from ${p.widthMm}×${p.heightMm} mm`;
    } else {
      let lo = sorted[0];
      let hi = sorted[sorted.length - 1];
      for (let i = 0; i < sorted.length - 1; i++) {
        if (targetArea >= sorted[i].area && targetArea <= sorted[i + 1].area) {
          lo = sorted[i];
          hi = sorted[i + 1];
          break;
        }
      }
      const t =
        hi.area === lo.area
          ? 0
          : (targetArea - lo.area) / (hi.area - lo.area);
      price = lo.price + (hi.price - lo.price) * t;
      anchorLabel = `interpolated ${lo.widthMm}×${lo.heightMm}–${hi.widthMm}×${hi.heightMm} mm`;
    }
  } else {
    const refArea = areaM2(input.reference.widthMm, input.reference.heightMm);
    if (refArea <= 0 || !Number.isFinite(input.reference.price)) {
      return fail("This product has no listed size/price to quote from");
    }
    price = input.reference.price * (targetArea / refArea);
    // Soft floor so tiny sizes don't go absurdly cheap
    price = Math.max(input.reference.price * 0.55, price);
  }

  price = Math.round(price * 100) / 100;

  return {
    ok: true,
    widthMm: w,
    heightMm: h,
    areaM2: Math.round(targetArea * 1000) / 1000,
    price,
    anchorLabel,
  };
}

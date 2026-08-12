/**
 * Otto Tiles PDP calculator — mirrors ottotiles.co.uk theme logic:
 *   piecesNeeded = m2 * tilesPerSqm
 *   piecesWithOverage = piecesNeeded * (1 + overage%)
 *   boxes = ceil(piecesWithOverage / tilesPerBox)
 *   totalM2 = ceil(boxes * tilesPerBox / tilesPerSqm)
 *   total = totalM2 * pricePerM2
 */

export type OttoCalcInput = {
  /** Customer-entered m² needed (before overage). */
  m2Needed: number;
  /** Overage percent: 0 | 10 | 15 | 20 | 25 */
  overagePercent: number;
  /** Selling price per m² (ex VAT on Otto; we keep the listed catalogue figure). */
  pricePerM2: number;
  /** Tiles in one box (pcsIn1Box). */
  tilesPerBox: number;
  /** Tiles covering 1 m² (pcsIn1Sqm). */
  tilesPerSqm: number;
  /** Minimum m² (Otto default 1). */
  minM2?: number;
  /** Maximum m² for the calculator (Otto default 30). */
  maxM2?: number;
};

export type OttoCalcResult = {
  m2Needed: number;
  overagePercent: number;
  tilesPerBox: number;
  tilesPerSqm: number;
  /** Ordered coverage after whole-box rounding (TOTAL M²). */
  totalM2: number;
  boxes: number;
  totalPieces: number;
  pricePerTile: number;
  total: number;
};

export function round2(n: number) {
  return Math.round(Math.max(0, n) * 100) / 100;
}

export function computeOttoOrder(input: OttoCalcInput): OttoCalcResult {
  const tilesPerBox = Math.max(0, Number(input.tilesPerBox) || 0);
  const tilesPerSqm = Math.max(0, Number(input.tilesPerSqm) || 0);
  const pricePerM2 = Math.max(0, Number(input.pricePerM2) || 0);
  const overagePercent = Math.max(0, Number(input.overagePercent) || 0);
  const minM2 = Math.max(0, Number(input.minM2 ?? 1) || 1);
  const maxM2 = Math.max(minM2, Number(input.maxM2 ?? 30) || 30);

  let m2Needed = Math.max(0, Number(input.m2Needed) || 0);
  if (m2Needed > 0 && m2Needed < minM2) m2Needed = minM2;
  if (m2Needed > maxM2) m2Needed = maxM2;

  if (!tilesPerBox || !tilesPerSqm || m2Needed <= 0) {
    const pricePerTile =
      tilesPerSqm > 0 ? round2(pricePerM2 / tilesPerSqm) : 0;
    return {
      m2Needed,
      overagePercent,
      tilesPerBox,
      tilesPerSqm,
      totalM2: 0,
      boxes: 0,
      totalPieces: 0,
      pricePerTile,
      total: 0,
    };
  }

  const piecesNeeded = m2Needed * tilesPerSqm;
  const piecesWithOverage = piecesNeeded * (1 + overagePercent / 100);
  const boxes = Math.max(1, Math.ceil(piecesWithOverage / tilesPerBox));
  const totalPieces = boxes * tilesPerBox;
  const m2PerTile = 1 / tilesPerSqm;
  /**
   * Area the whole boxes actually cover.
   *
   * This used to be `Math.ceil`ed to a whole square metre and the total taken
   * from that, so 3 boxes covering 1.5m² were charged as 2m² — a 10% overage
   * doubled the price and the customer paid for half a metre they never
   * received. Boxes are still rounded up; the area they supply is not.
   */
  const totalM2 = round2(totalPieces * m2PerTile);
  const total = round2(totalM2 * pricePerM2);
  const pricePerTile = round2(total / totalPieces);

  return {
    m2Needed,
    overagePercent,
    tilesPerBox,
    tilesPerSqm,
    totalM2,
    boxes,
    totalPieces,
    pricePerTile,
    total,
  };
}

/** Derive tiles/m² from a Size(s) string like "20 x 20 x 1.2 cm". */
export function deriveTilesPerSqmFromSize(sizeRaw: unknown): number | null {
  const s = String(sizeRaw || "");
  const m = s.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
  );
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!(a > 0 && b > 0)) return null;
  // Treat numbers < 10 as metres (unlikely); otherwise centimetres.
  const wM = a >= 10 ? a / 100 : a;
  const hM = b >= 10 ? b / 100 : b;
  const area = wM * hM;
  if (!(area > 0)) return null;
  return Math.round(1 / area);
}

export function parsePositiveNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

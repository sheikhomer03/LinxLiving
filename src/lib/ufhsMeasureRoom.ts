/** UFHS "Measure My Room" calculator — same formula as their PDP modal. */

export type UfhsUnheatedArea = {
  width: string;
  length: string;
};

export type UfhsMeasureResult = {
  totalArea: number;
  fittedArea: number;
  totalAreaLabel: string;
  fittedAreaLabel: string;
};

function parsePositive(raw: string): number | null {
  const n = Number(String(raw || "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Area to warm = room − unheated rectangles.
 * Recommended fitted size = 90% of area to warm (UFHS uses * 0.9).
 */
export function calculateUfhsRoomArea(
  roomLength: string,
  roomWidth: string,
  unheated: UfhsUnheatedArea[],
): { ok: true; result: UfhsMeasureResult } | { ok: false; error: string } {
  const length = parsePositive(roomLength);
  const width = parsePositive(roomWidth);
  if (length == null || width == null) {
    return {
      ok: false,
      error: "Enter the longest length wall and longest width wall in metres.",
    };
  }

  const roomArea = length * width;
  let unheatedArea = 0;
  for (const row of unheated || []) {
    const w = parsePositive(row.width);
    const l = parsePositive(row.length);
    if (w == null && l == null) continue;
    if (w == null || l == null) {
      return {
        ok: false,
        error: "Each unheated area needs both width and length, or leave both blank.",
      };
    }
    unheatedArea += w * l;
  }

  if (unheatedArea >= roomArea) {
    return {
      ok: false,
      error: "Unheated areas cannot be larger than the room area.",
    };
  }

  const total = roomArea - unheatedArea;
  const fitted = total * 0.9;
  return {
    ok: true,
    result: {
      totalArea: total,
      fittedArea: fitted,
      totalAreaLabel: total.toFixed(2),
      fittedAreaLabel: fitted.toFixed(2),
    },
  };
}

/** Parse coverage labels like "1.5m2" / "12.0m²". */
export function parseCoverageSqm(label: string): number | null {
  const m = String(label || "").match(/(\d+(?:\.\d+)?)\s*m/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Prefer largest coverage ≤ fitted area; otherwise smallest available. */
export function nearestCoverageValue(
  values: string[],
  fittedArea: number,
): string | null {
  const rows = values
    .map((raw) => ({ raw, n: parseCoverageSqm(raw) }))
    .filter((r): r is { raw: string; n: number } => r.n != null)
    .sort((a, b) => a.n - b.n);
  if (!rows.length) return null;
  let best: { raw: string; n: number } | null = null;
  for (const row of rows) {
    if (row.n <= fittedArea + 0.001) best = row;
  }
  return (best || rows[0]).raw;
}

/** Show Measure My Room when UFHS would (electric coverage kits). */
export function shouldShowMeasureMyRoom(input: {
  hasMeasureMyRoom?: boolean | null;
  shopifyOptionNames?: string[];
  coverageValues?: string[];
  productName?: string;
}): boolean {
  if (input.hasMeasureMyRoom === true) return true;
  if (input.hasMeasureMyRoom === false) return false;

  const coverage = (input.coverageValues || []).some(
    (v) => parseCoverageSqm(v) != null,
  );
  if (!coverage) return false;

  const names = (input.shopifyOptionNames || []).join(" ");
  if (/wattage/i.test(names)) return true;

  const product = String(input.productName || "");
  if (/water underfloor|wet underfloor/i.test(product)) return false;
  return /electric|mat kit|foil|heating cable|dcm-pro/i.test(product);
}

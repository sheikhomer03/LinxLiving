/**
 * Map product `specs.size` values into Small / Medium / Large / Extra large
 * for department mega-menu Size columns.
 *
 * Supports "55cm x 98cm", "600x600" (mm tiles → cm), "600 × 600", etc.
 */

export type SizeBucketKey = "small" | "medium" | "large" | "xl";

export const SIZE_BUCKET_DEFS: {
  key: SizeBucketKey;
  label: string;
}[] = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
  { key: "xl", label: "Extra large" },
];

export type SizeBucketFacet = {
  key: SizeBucketKey;
  label: string;
  /** Example size shown in the mega menu label */
  example: string;
  /** Actual specs.size values in this bucket (for catalogue `size=` filter) */
  sizes: string[];
  count: number;
};

/** Parse width/height in centimetres from a free-text size. */
export function parseSizeCm(
  raw: string,
): { w: number; h: number } | null {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/×/g, "x")
    .trim();
  if (!s || s === "n/a" || s === "na") return null;

  let m = s.match(
    /(\d+(?:\.\d+)?)\s*cm\s*x\s*(\d+(?:\.\d+)?)\s*cm/,
  );
  if (m) return { w: Number(m[1]), h: Number(m[2]) };

  m = s.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  let w = Number(m[1]);
  let h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  // Tile-style millimetres (e.g. 600x600) when unit is not "cm"
  if (!/\bcm\b/.test(s) && w >= 50 && h >= 50) {
    w /= 10;
    h /= 10;
  }
  return { w, h };
}

/**
 * Bucket by longest side (cm):
 * Small ≤ 70 · Medium ≤ 100 · Large ≤ 130 · Extra large > 130
 */
export function sizeBucketKey(raw: string): SizeBucketKey | null {
  const dims = parseSizeCm(raw);
  if (!dims) return null;
  const max = Math.max(dims.w, dims.h);
  if (max <= 70) return "small";
  if (max <= 100) return "medium";
  if (max <= 130) return "large";
  return "xl";
}

/** Build facets from { size, count } rows — only buckets that have products. */
export function buildSizeBucketFacets(
  rows: { size: string; count: number }[],
): SizeBucketFacet[] {
  const buckets: Record<
    SizeBucketKey,
    { sizes: Map<string, number>; total: number }
  > = {
    small: { sizes: new Map(), total: 0 },
    medium: { sizes: new Map(), total: 0 },
    large: { sizes: new Map(), total: 0 },
    xl: { sizes: new Map(), total: 0 },
  };

  for (const row of rows) {
    const size = String(row.size || "").trim();
    if (!size) continue;
    const key = sizeBucketKey(size);
    if (!key) continue;
    const n = Number(row.count) || 0;
    buckets[key].sizes.set(size, (buckets[key].sizes.get(size) || 0) + n);
    buckets[key].total += n;
  }

  const out: SizeBucketFacet[] = [];
  for (const def of SIZE_BUCKET_DEFS) {
    const b = buckets[def.key];
    if (b.total <= 0 || b.sizes.size === 0) continue;
    const sorted = [...b.sizes.entries()].sort((a, c) => c[1] - a[1]);
    out.push({
      key: def.key,
      label: def.label,
      example: sorted[0][0],
      sizes: sorted.map(([s]) => s),
      count: b.total,
    });
  }
  return out;
}

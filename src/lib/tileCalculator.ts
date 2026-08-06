/**
 * Area-based pricing for products sold by the square metre (tiles, flooring,
 * wall panels) — the calculator that lives on the product page itself.
 *
 * Pricing is always taken from the product being viewed, so each brand keeps
 * its own price list automatically. Nothing here is hard-coded per brand.
 *
 * Unit convention: `product.price` is the BOX price, quoted against a
 * "SQM Per Box" figure — this is how the trade lists are imported (Spectra
 * "Elijah Gold": 600x600, 1.44 SQM per box, Price ex VAT 14). The per-m² rate
 * customers see is therefore price ÷ box coverage, and price per tile, tile
 * count and box count are all derived from there.
 */

import { parseSizeToMm, areaM2 } from "@/lib/configuratorSizePrice";

/** Default allowance for cuts and breakages, matching industry practice. */
export const DEFAULT_WASTAGE_PERCENT = 10;

/**
 * Which products are "tiles and flooring" in practice.
 *
 * Category names cannot answer this: the Spectra tiles are filed under
 * department "building-materials" with categories named after their finish
 * ("gloss", "matt", "matt-carving"). Nothing says "tile" anywhere. What every
 * tile/flooring product does carry is a "SQM Per Box" spec, and nothing else
 * in the catalogue does — so box coverage is the reliable signal, and it is
 * what isAreaSoldProduct() below tests.
 *
 * The keyword list is kept only as an additional allow-path for ranges that
 * are named conventionally.
 */
export const AREA_SOLD_KEYWORDS = [
  "tile",
  "tiles",
  "floor",
  "flooring",
  "wall-and-floor",
  "floor-and-wall",
  "laminate",
  "parquet",
  "vinyl",
  "mosaic",
  "carpet",
  "wood-flooring",
  "lvt",
  "porcelain",
  "ceramic",
  "natural-stone",
  "gloss",
  "high-gloss",
  "matt",
  "matt-carving",
];

/**
 * Bespoke ranges: configure, then enquire — never buy online.
 *
 * Deliberately narrow. Generic "window" / "rooflight" / "skylight" are NOT
 * listed: they would capture the entire Fakro roof-window range (~2,479
 * products) which is stock-sized and currently sold online. Roof windows can
 * be added once that has been confirmed as intended.
 */
export const MADE_TO_MEASURE_KEYWORDS = [
  "window",
  "windows",
  "door",
  "doors",
  "front-door",
  "front-doors",
  "pergola",
  "pergolas",
  "awning",
  "awnings",
  "bi-fold",
  "bifold",
  "bespoke",
  "made-to-measure",
  "made-to-order",
  "conservatory",
  "rooflight",
  "roof-window",
  "skylight",
];

function matchesKeyword(haystack: string[], keywords: string[]): boolean {
  const parts = haystack
    .filter(Boolean)
    .map((s) => String(s).trim().toLowerCase());
  return parts.some((p) =>
    keywords.some(
      (k) => p === k || p.includes(k) || p.replace(/\s+/g, "-").includes(k),
    ),
  );
}

/**
 * Ranges that contain a tile/flooring word but are not sold by the m².
 * "underfloor-heating" is the important one — it contains "floor", which was
 * enough to price heating thermostats and fixings per square metre.
 */
const NOT_AREA_SOLD_RX =
  /under.?floor|thermostat|heating|skirting|adhesive|grout|leveller|underlay|accessor|fixing|trim|profile/i;

/** True when the product belongs to a tile / flooring range. */
export function isAreaSoldCategory(input: {
  department?: string | null;
  category?: string | null;
  subCategory?: string | null;
}): boolean {
  const parts = [
    input.department || "",
    input.category || "",
    input.subCategory || "",
  ];
  if (parts.some((p) => NOT_AREA_SOLD_RX.test(String(p)))) return false;
  return matchesKeyword(parts, AREA_SOLD_KEYWORDS);
}

/**
 * Wall calculator (Floor/Walls tabs) only makes sense for tiles / wall-capable
 * ranges — not pure flooring like laminate, LVT, carpet, engineered wood.
 */
const WALL_CAPABLE_KEYWORDS = [
  "tile",
  "tiles",
  "porcelain",
  "ceramic",
  "mosaic",
  "natural-stone",
  "wall-and-floor",
  "floor-and-wall",
  "gloss",
  "high-gloss",
  "matt",
  "matt-carving",
];

const FLOOR_ONLY_KEYWORDS = [
  "laminate",
  "vinyl",
  "lvt",
  "carpet",
  "parquet",
  "wood-flooring",
  "engineered",
  "hardwood",
  "herringbone",
];

export function supportsWallsCalculator(input: {
  department?: string | null;
  category?: string | null;
  subCategory?: string | null;
}): boolean {
  const parts = [
    input.department || "",
    input.category || "",
    input.subCategory || "",
  ];
  if (matchesKeyword(parts, FLOOR_ONLY_KEYWORDS)) return false;
  if (String(input.department || "").toLowerCase() === "tiles") return true;
  return matchesKeyword(parts, WALL_CAPABLE_KEYWORDS);
}

/** True when the product is bespoke / made to measure. */
export function isMadeToMeasure(input: {
  department?: string | null;
  category?: string | null;
  subCategory?: string | null;
}): boolean {
  return matchesKeyword(
    [input.department || "", input.category || "", input.subCategory || ""],
    MADE_TO_MEASURE_KEYWORDS,
  );
}

export type AreaProductInput = {
  /** Price per m², inclusive of VAT. */
  pricePerSqm: number;
  /** Raw size spec, e.g. "600x600" or "20cm x 20cm". */
  size?: string | null;
  /** Raw box spec, e.g. "1.44 SQM". */
  sqmPerBox?: string | number | null;
};

export type AreaQuote = {
  /** m² the customer actually needs, before wastage. */
  areaM2: number;
  /** m² to order once wastage and whole-box rounding are applied. */
  orderAreaM2: number;
  pricePerSqm: number;
  /** Derived: price of a single tile (null when tile size is unknown). */
  pricePerTile: number | null;
  /** Derived: area of one tile in m² (null when size is unknown). */
  tileAreaM2: number | null;
  /** Whole tiles needed to cover orderAreaM2. */
  tiles: number | null;
  /** m² in one box (null when not specified). */
  sqmPerBox: number | null;
  /** Whole boxes needed (null when box size is unknown). */
  boxes: number | null;
  /** Final price for the quantity being ordered. */
  total: number;
  wastagePercent: number;
};

/**
 * Price per m² for an area-sold product.
 *
 * The imported trade lists quote a BOX price against a "SQM Per Box" figure —
 * e.g. Spectra "Elijah Gold": 600x600, 1.44 SQM per box, Price ex VAT 14.
 * That £14 buys a box covering 1.44m², so the per-m² rate is 14 / 1.44 = £9.72.
 *
 * Falls back to the raw price when no box coverage is recorded, which is the
 * only sane reading of a price with no area attached to it.
 */
export function pricePerSqmFrom(
  price: number,
  sqmPerBox: string | number | null | undefined,
): number {
  const p = Number(price) || 0;
  const box = parseSqmPerBox(sqmPerBox);
  if (!box || box <= 0) return p;
  return Math.round((p / box) * 100) / 100;
}

/** "1.44 SQM" | "1.44" | 1.44 → 1.44 */
export function parseSqmPerBox(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Area of a single unit in m², from its size spec. */
export function tileAreaFromSize(size: string | null | undefined): number | null {
  const parsed = parseSizeToMm(size);
  if (!parsed) return null;
  const a = areaM2(parsed.widthMm, parsed.heightMm);
  return Number.isFinite(a) && a > 0 ? a : null;
}

/**
 * True when a product should show the area calculator rather than a plain
 * quantity stepper. Requires a usable price and enough spec to derive area —
 * a box size or a parseable tile size.
 */
export function isAreaSoldProduct(input: AreaProductInput): boolean {
  if (!Number.isFinite(input.pricePerSqm) || input.pricePerSqm <= 0) return false;
  return (
    parseSqmPerBox(input.sqmPerBox) !== null ||
    tileAreaFromSize(input.size) !== null
  );
}

/**
 * Quote for a requested area.
 *
 * Order of operations mirrors how a merchant quotes: add wastage to the
 * measured area, then round up to whole boxes (you cannot buy part of a box),
 * and price the rounded figure.
 */
export function quoteByArea(
  input: AreaProductInput & {
    /** m² the customer measured. */
    requestedM2: number;
    wastagePercent?: number;
    /** Listed box price, used to price whole boxes exactly. */
    boxPrice?: number | null;
    /** Round up to whole boxes when a box size is known. */
    roundToBox?: boolean;
  },
): AreaQuote {
  const pricePerSqm = Number(input.pricePerSqm) || 0;
  const wastagePercent = Math.max(0, Number(input.wastagePercent ?? 0));
  const tileAreaM2 = tileAreaFromSize(input.size);
  const sqmPerBox = parseSqmPerBox(input.sqmPerBox);
  const roundToBox = input.roundToBox !== false;

  const requested = Math.max(0, Number(input.requestedM2) || 0);
  const withWastage = requested * (1 + wastagePercent / 100);

  let orderAreaM2 = withWastage;
  let boxes: number | null = null;
  if (sqmPerBox && roundToBox && withWastage > 0) {
    boxes = Math.ceil(withWastage / sqmPerBox);
    orderAreaM2 = boxes * sqmPerBox;
  }

  const tiles =
    tileAreaM2 && orderAreaM2 > 0 ? Math.ceil(orderAreaM2 / tileAreaM2) : null;

  // Price whole boxes at the listed box price when we have one. Multiplying the
  // rounded per-m² rate instead drifts by a penny (1.44 × £6.94 = £9.99, not
  // the £10.00 the box actually costs).
  const total =
    boxes != null && input.boxPrice != null
      ? round2(boxes * Number(input.boxPrice))
      : round2(orderAreaM2 * pricePerSqm);

  return {
    areaM2: requested,
    orderAreaM2: round2(orderAreaM2),
    pricePerSqm,
    pricePerTile: tileAreaM2 ? round2(pricePerSqm * tileAreaM2) : null,
    tileAreaM2,
    tiles,
    sqmPerBox,
    boxes,
    total,
    wastagePercent,
  };
}

/** Convert a tile count back to the area it covers, for the tiles input. */
export function areaFromTiles(
  tiles: number,
  size: string | null | undefined,
): number | null {
  const tileAreaM2 = tileAreaFromSize(size);
  if (!tileAreaM2) return null;
  const n = Math.max(0, Number(tiles) || 0);
  return round2(n * tileAreaM2);
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

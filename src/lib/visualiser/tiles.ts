/**
 * Room visualiser: which tiles it can lay, and how.
 *
 * Every tile in the Tiles department can be laid on the floor and on any wall
 * the scanner found. Only the department's non-tile products are left out —
 * grout, adhesive, sealant, trims, spacers, tools, heating mats and the like —
 * by category first and, for the few filed under a tile category, by name.
 *
 * The design is the product's first gallery still (the flat sample sits first
 * for tiles), laid at the size the data states. Pure functions over a product
 * document, so the product page, the visualiser page and its API all decide
 * the same way.
 */
import { cdnImageUrl } from "@/lib/productImage";
import {
  firstStillImage,
  inferGloss,
  type VisualiserDesign,
  type VisualiserLayout,
} from "@/lib/visualiser/flooring";

export const TILES_DEPARTMENT = "tiles";

/** Tiles-department categories that hold accessories, not tiles. */
export const TILE_ACCESSORY_CATEGORIES = [
  "grout",
  "glitter-grout",
  "tile-adhesive",
  "sealing-and-cleaning",
  "tiletrim",
  "spacers",
  "tiling-tools",
  "tiling-preparation",
  "silicone",
];

/**
 * Names of accessories filed under a tile category (Mapei grout under
 * outdoor-tiles, silicone under ceramic-tiles, heating mats under wet-room).
 *
 * Whole words only. Checked against every Tiles product name: "Kit Kat",
 * "Pallet Deal" slabs and "Wall & Floor Tile" must all stay, so neither "kit"
 * nor "pallet" is here.
 */
export const TILE_EXCLUDED_NAME_PATTERN =
  "\\b(grout|grouts|adhesive|adhesives|sealant|sealants|sealer|silicone|primer|spacers?|tools?|drill|cutter|leveller|levelling|protector|cleaner|membrane|tanking|insulation board|underfloor heating|heating mat|composite trim|trims?|profiles?|bucket|sponge|trowel|backer ?board|screed)\\b";

const EXCLUDED_NAME_RX = new RegExp(TILE_EXCLUDED_NAME_PATTERN, "i");

type ProductLike = {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  department?: unknown;
  category?: unknown;
  subCategory?: unknown;
  categories?: unknown;
  images?: string[] | null;
  shopifyImages?: { sourceUrl?: string | null; shopifyUrl?: string | null; position?: number | null }[] | null;
  specs?: Record<string, unknown> | null;
  dimensions?: Record<string, unknown> | null;
  finish?: unknown;
  packCoverageM2?: unknown;
};

const str = (v: unknown) => (v == null ? "" : String(v)).trim();
const lower = (v: unknown) => str(v).toLowerCase();

/** Case-insensitive scalar spec lookup. */
function pickSpec(specs: Record<string, unknown> | null | undefined, key: string) {
  if (!specs) return "";
  const direct = specs[key];
  if (direct != null && typeof direct !== "object" && str(direct)) return str(direct);
  const hit = Object.entries(specs).find(([k]) => k.toLowerCase() === key.toLowerCase());
  return hit && hit[1] != null && typeof hit[1] !== "object" ? str(hit[1]) : "";
}

/** Whether the visualiser can lay this tile. */
export function isVisualisableTile(product: ProductLike | null | undefined): boolean {
  if (!product) return false;
  if (lower(product.department) !== TILES_DEPARTMENT) return false;
  const cats = [lower(product.category), ...(Array.isArray(product.categories) ? product.categories.map(lower) : [])];
  if (cats.some((c) => TILE_ACCESSORY_CATEGORIES.includes(c))) return false;
  if (EXCLUDED_NAME_RX.test(str(product.name))) return false;
  return Boolean(firstStillImage(product));
}

/** Smallest and largest tile/slab side the visualiser accepts, mm. */
const MIN_MM = 10;
const MAX_MM = 3200;

/**
 * Millimetres from a tile size, or null when it is not a plausible tile.
 *
 * Suppliers write sizes three ways: with a unit ("600 x 1200mm",
 * "60cm x 120cm", "600x600x10.5 mm"), or bare. Bare sizes in this catalogue
 * are centimetres for anything up to 200 ("60x60", "59.8x89.8", "15x15") and
 * millimetres above it ("600x600", "1235x178") — the shared parseSizeCm reads
 * every bare value of 50 or more as millimetres, which would lay a 60 cm tile
 * at 6 cm, so tiles use their own rule.
 */
export function tileSizeMm(raw: string): { w: number; h: number } | null {
  const s = String(raw || "").toLowerCase().replace(/×/g, "x").replace(/,/g, ".");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(mm|cm)?\s*x\s*(\d+(?:\.\d+)?)\s*(mm|cm)?/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  if (!(a > 0) || !(b > 0)) return null;
  // The unit beside either number, else one written anywhere later
  // ("600x600x10.5 mm"), else the bare-number rule.
  const tail = s.slice((m.index ?? 0) + m[0].length);
  const unit = m[4] || m[2] || (/^\s*(?:x\s*[\d.]+\s*)?(mm|cm)\b/.exec(tail)?.[1] ?? "");
  const factor = unit === "mm" ? 1 : unit === "cm" ? 10 : Math.max(a, b) <= 200 ? 10 : 1;
  const w = Math.round(Math.min(a, b) * factor);
  const h = Math.round(Math.max(a, b) * factor);
  if (w < MIN_MM || h > MAX_MM) return null;
  return { w, h };
}

const DEFAULT_TILE = { w: 300, h: 600 };

function inferTileSize(product: ProductLike): {
  sizeMm: { w: number; h: number };
  sizeSource: VisualiserDesign["sizeSource"];
} {
  const specs = product.specs ?? null;
  const dims = (product.dimensions ?? null) as Record<string, unknown> | null;
  const candidates: [VisualiserDesign["sizeSource"], string][] = [
    ["specs", pickSpec(specs, "size")],
    ["specs", pickSpec(specs, "Size(s)")],
    ["dimensions", str(dims?.size)],
    ["name", str(product.name)],
  ];
  for (const [source, raw] of candidates) {
    const size = tileSizeMm(raw);
    if (size) return { sizeMm: size, sizeSource: source };
  }
  // Tiles per m² gives a square tile's side.
  const perSqm = Number(
    String(pickSpec(specs, "tilesPerSqm") || pickSpec(specs, "pcsIn1Sqm") || "").replace(/[^0-9.]/g, ""),
  );
  if (Number.isFinite(perSqm) && perSqm > 0) {
    const side = Math.round(Math.sqrt(1 / perSqm) * 1000);
    if (side >= MIN_MM && side <= MAX_MM) return { sizeMm: { w: side, h: side }, sizeSource: "tilesPerSqm" };
  }
  return { sizeMm: DEFAULT_TILE, sizeSource: "default" };
}

function textOf(product: ProductLike) {
  return `${lower(product.name)} ${lower(product.category)} ${lower(product.subCategory)}`;
}

function inferTileLayout(product: ProductLike): VisualiserLayout {
  const text = textOf(product);
  if (/herringbone|chevron/.test(text)) return "herringbone";
  if (/basket ?weave/.test(text)) return "basketweave";
  if (/\b(metro|subway|brick)\b/.test(text)) return "brick";
  return "grid";
}

/** Mosaic sheets carry their own joints in the photograph. */
function isMosaic(product: ProductLike) {
  return /mosaic/.test(textOf(product));
}

function inferPackCoverage(product: ProductLike): number | null {
  const specs = product.specs ?? null;
  for (const raw of [
    product.packCoverageM2,
    pickSpec(specs, "packCoverageM2"),
    pickSpec(specs, "sqmPerBox"),
    pickSpec(specs, "packCoverage"),
  ]) {
    const n = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0.05 && n < 200) return n;
  }
  return null;
}

/** Everything the visualiser needs to lay this tile, or null when it cannot. */
export function toTileDesign(product: ProductLike | null | undefined): VisualiserDesign | null {
  if (!product || !isVisualisableTile(product)) return null;
  const first = firstStillImage(product);
  const { sizeMm, sizeSource } = inferTileSize(product);
  return {
    id: str(product._id ?? product.id),
    name: str(product.name),
    kind: "tile",
    surfaces: ["floor", "wall"],
    image: cdnImageUrl(first, 512),
    thumb: cdnImageUrl(first, 120),
    material: "tile",
    sizeMm,
    sizeSource,
    layout: inferTileLayout(product),
    gloss: inferGloss(product),
    packCoverageM2: inferPackCoverage(product),
    // A 2 mm joint, except on mosaic sheets whose joints are in the photo.
    groutMm: isMosaic(product) ? 0 : 2,
  };
}

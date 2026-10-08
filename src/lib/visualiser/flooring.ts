/**
 * Room visualiser: which products it can lay, and how.
 *
 * Flooring only, for now. A product is visualisable when it is filed under the
 * Flooring department, is an actual floor covering (not a mat, rug, trim,
 * underlay or fitting product) and has a photograph. Its design is its first
 * gallery still, laid at the plank size its data states — or, when the data
 * has none, at a typical size for the material.
 *
 * Pure functions over a product document, so the product page, the visualiser
 * page and its API all decide eligibility the same way.
 */
import {
  cdnImageUrl,
  isGalleryVideoUrl,
  resolveGalleryImages,
  type ShopifyImagePair,
} from "@/lib/productImage";
import { parseSizeCm } from "@/lib/sizeBuckets";

export const VISUALISER_DEPARTMENT = "flooring";

/** Flooring categories that are not laid as a floor. */
export const VISUALISER_EXCLUDED_CATEGORIES = ["mats-runners", "rugs", "grass"];

/** Flooring sub-categories that are not laid as a floor. */
export const VISUALISER_EXCLUDED_SUBCATEGORIES = [
  "rugs-runners",
  "coir-mats",
  "designer-mats",
  "universal-mats",
];

/**
 * Names of fitting and finishing products filed under Flooring.
 *
 * Whole words only: "Matt" finishes, "Oiled" oak and "Glue Down" LVT are all
 * genuine floors and must not match. "Strip" only as an expansion or feature
 * strip — "3 Strip Oak" is a floor — and glue only as PVA or joint glue, so
 * "Glue Down" LVT stays; "fibre board" is underlay board, while "Fibre — Wool"
 * carpets stay. Checked against every Flooring product name: each
 * match is a fitting or finishing product.
 */
export const VISUALISER_EXCLUDED_NAME_PATTERN =
  "\\b(mat|mats|runner|runners|rug|rugs|doormat|underlay|underlays|adhesive|adhesives|trim|trims|threshold|thresholds|scotia|beading|skirting|wallbase|edging|stair ?nose|nosing|profiles?|transition|reducer|end ?caps?|quadrant|abrasive|abrasives|sanding|sealant|cleaner|cleaning|maintenance|lacquer|primer|levelling|leveller|screed|filler|wax|repair|cutter|gripper|knee pads?|felt pads?|expansion strip|feature strip|spacers?|tools?|kit|pipe (covers?|surrounds?|collars?|roses?)|scraper|blades?|pva|joint glue|fibre ?boards?)\\b";

const EXCLUDED_NAME_RX = new RegExp(VISUALISER_EXCLUDED_NAME_PATTERN, "i");

export type VisualiserMaterial = "laminate" | "vinyl" | "engineered" | "carpet" | "tile";

/** A scanned surface a design can be laid on. */
export type SurfaceKind = "floor" | "wall";

export type VisualiserLayout =
  | "grid"
  | "brick"
  | "brick-third"
  | "herringbone"
  | "basketweave";

/** What the visualiser needs to lay one product. */
export type VisualiserDesign = {
  id: string;
  name: string;
  /** Flooring (floor only) or a tile (floor and walls). */
  kind: "flooring" | "tile";
  /** The surfaces this design may be laid on — enforced by the store. */
  surfaces: SurfaceKind[];
  /** First gallery still, sized for a WebGL texture. */
  image: string;
  /** Same still, sized for a thumbnail. */
  thumb: string;
  material: VisualiserMaterial;
  /** Width × length of one plank/tile in millimetres (w ≤ h). */
  sizeMm: { w: number; h: number };
  /** Where the size came from; "default" means the data had none. */
  sizeSource: "specs" | "dimensions" | "plank" | "name" | "tilesPerSqm" | "default";
  layout: VisualiserLayout;
  gloss: number;
  /** m² one pack covers, when known (for the pack estimate). */
  packCoverageM2: number | null;
  /** Joint width (mm) the design starts with; flooring has none. */
  groutMm?: number;
};

type ProductLike = {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  department?: unknown;
  category?: unknown;
  subCategory?: unknown;
  categories?: unknown;
  subCategories?: unknown;
  images?: string[] | null;
  shopifyImages?: ShopifyImagePair[] | null;
  specs?: Record<string, unknown> | null;
  dimensions?: Record<string, unknown> | null;
  finish?: unknown;
  packCoverageM2?: unknown;
};

const str = (v: unknown) => (v == null ? "" : String(v)).trim();
const lower = (v: unknown) => str(v).toLowerCase();
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(lower).filter(Boolean) : [];

/** Typical sizes when a product states none (mm), matching the engine's catalogue. */
const DEFAULT_SIZE: Record<VisualiserMaterial, { w: number; h: number }> = {
  laminate: { w: 195, h: 1380 },
  vinyl: { w: 185, h: 1220 },
  engineered: { w: 190, h: 1900 },
  // Carpet is a continuous sheet; this is only how large one repeat of the
  // photograph is laid.
  carpet: { w: 1000, h: 1000 },
  // Never inferred for flooring; tiles size themselves (lib/visualiser/tiles).
  tile: { w: 300, h: 600 },
};

/** Case-insensitive spec lookup, as the product page reads specs. */
function pickSpec(specs: Record<string, unknown> | null | undefined, key: string) {
  if (!specs) return "";
  const direct = specs[key];
  if (direct != null && str(direct)) return str(direct);
  const hit = Object.entries(specs).find(([k]) => k.toLowerCase() === key.toLowerCase());
  return hit && hit[1] != null ? str(hit[1]) : "";
}

/** The product's first still photograph (videos skipped), or "". */
export function firstStillImage(product: ProductLike): string {
  const gallery = resolveGalleryImages({
    images: product.images ?? null,
    shopifyImages: product.shopifyImages ?? null,
  });
  return gallery.find((src) => src && !isGalleryVideoUrl(src) && !/\.svg($|\?)/i.test(src)) || "";
}

/** Whether the visualiser can lay this product. */
export function isVisualisableFlooring(product: ProductLike | null | undefined): boolean {
  if (!product) return false;
  if (lower(product.department) !== VISUALISER_DEPARTMENT) return false;

  const cats = [lower(product.category), ...list(product.categories)];
  if (cats.some((c) => VISUALISER_EXCLUDED_CATEGORIES.includes(c))) return false;
  const subs = [lower(product.subCategory), ...list(product.subCategories)];
  if (subs.some((s) => VISUALISER_EXCLUDED_SUBCATEGORIES.includes(s))) return false;

  if (EXCLUDED_NAME_RX.test(str(product.name))) return false;
  return Boolean(firstStillImage(product));
}

function inferMaterial(product: ProductLike): VisualiserMaterial {
  const text = [
    product.category,
    product.subCategory,
    ...(Array.isArray(product.categories) ? product.categories : []),
    ...(Array.isArray(product.subCategories) ? product.subCategories : []),
    product.name,
  ]
    .map(lower)
    .join(" ");
  if (/\bcarpets?\b/.test(text)) return "carpet";
  if (/laminate/.test(text)) return "laminate";
  if (/\b(lvt|spc|wpc)\b|luxury[- ]vinyl|vinyl|rigid core/.test(text)) return "vinyl";
  if (/engineered|parquet|herringbone|chevron|solid[- ]wood|hardwood|\boak\b|\bwood/.test(text)) {
    return "engineered";
  }
  return "laminate";
}

/** Millimetres from a free-text size, or null when it is not a plausible plank/tile. */
function sizeFrom(raw: string): { w: number; h: number } | null {
  if (!raw) return null;
  const cm = parseSizeCm(raw);
  if (!cm) return null;
  const a = Math.round(cm.w * 10);
  const b = Math.round(cm.h * 10);
  const w = Math.min(a, b);
  const h = Math.max(a, b);
  // 50 mm is narrower than any strip floor; 3 m is longer than any plank.
  if (w < 50 || h > 3000) return null;
  return { w, h };
}

function inferSize(
  product: ProductLike,
  material: VisualiserMaterial,
): { sizeMm: { w: number; h: number }; sizeSource: VisualiserDesign["sizeSource"] } {
  if (material === "carpet") return { sizeMm: DEFAULT_SIZE.carpet, sizeSource: "default" };

  const specs = product.specs ?? null;
  const dims = (product.dimensions ?? null) as Record<string, unknown> | null;
  const candidates: [VisualiserDesign["sizeSource"], string][] = [
    ["specs", pickSpec(specs, "size")],
    ["dimensions", str(dims?.size)],
    ["dimensions", dims?.length && dims?.width ? `${str(dims.length)} x ${str(dims.width)}` : ""],
    [
      "plank",
      (dims?.plank_length || dims?.length) && (dims?.width1 || dims?.width)
        ? `${str(dims?.plank_length || dims?.length)} x ${str(dims?.width1 || dims?.width)}`
        : "",
    ],
    ["name", str(product.name)],
  ];
  for (const [source, raw] of candidates) {
    const size = sizeFrom(raw);
    if (size) return { sizeMm: size, sizeSource: source };
  }
  return { sizeMm: DEFAULT_SIZE[material], sizeSource: "default" };
}

function inferLayout(
  product: ProductLike,
  material: VisualiserMaterial,
  sizeMm: { w: number; h: number },
): VisualiserLayout {
  if (material === "carpet") return "grid";
  const text = `${lower(product.name)} ${lower(product.subCategory)}`;
  if (/herringbone|chevron/.test(text)) return "herringbone";
  if (/basket ?weave/.test(text)) return "basketweave";
  // Square-ish units (LVT tiles, stone-effect vinyl) are laid as a grid;
  // planks run in a third-offset bond, the usual way a floor is fitted.
  return sizeMm.h / sizeMm.w >= 2.5 ? "brick-third" : "grid";
}

export function inferGloss(product: ProductLike): number {
  const finish = `${lower(product.finish)} ${lower(pickSpec(product.specs, "finish"))}`;
  if (/high[- ]?gloss|polished/.test(finish)) return 0.55;
  if (/gloss|lacquer/.test(finish)) return 0.4;
  if (/satin|semi/.test(finish)) return 0.25;
  // Matt or unknown: no added sheen, as the testing-app visualiser lays a
  // product (the photo's own lighting still carries through).
  return 0;
}

function inferPackCoverage(product: ProductLike): number | null {
  const specs = product.specs ?? null;
  const dims = (product.dimensions ?? null) as Record<string, unknown> | null;
  const raws = [
    product.packCoverageM2,
    pickSpec(specs, "packCoverageM2"),
    pickSpec(specs, "sqmPerBox"),
    pickSpec(specs, "Pack Coverage"),
    pickSpec(specs, "packCoverage"),
    pickSpec(specs, "Pack Size"),
    dims?.coverage,
    dims?.pack_size,
  ];
  for (const raw of raws) {
    const n = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
    // A pack covers somewhere between a fraction of a m² and a pallet.
    if (Number.isFinite(n) && n > 0.05 && n < 200) return n;
  }
  return null;
}

/** Everything the visualiser needs to lay this product, or null when it cannot. */
export function toVisualiserDesign(product: ProductLike | null | undefined): VisualiserDesign | null {
  if (!product || !isVisualisableFlooring(product)) return null;
  const first = firstStillImage(product);
  const material = inferMaterial(product);
  const { sizeMm, sizeSource } = inferSize(product, material);
  return {
    id: str(product._id ?? product.id),
    name: str(product.name),
    kind: "flooring",
    surfaces: ["floor"],
    // cdnImageUrl doubles the width for retina: 512 → a 1024 px texture.
    image: cdnImageUrl(first, 512),
    thumb: cdnImageUrl(first, 120),
    material,
    sizeMm,
    sizeSource,
    layout: inferLayout(product, material, sizeMm),
    gloss: inferGloss(product),
    packCoverageM2: inferPackCoverage(product),
  };
}

/**
 * Import the RAK Ceramics 2026 bathroom retail price list into Mongo.
 *
 * Every row of the price list is one sellable code, so every row becomes one
 * product — RAK price a 60cm 1-taphole basin and a 60cm 3-taphole basin as
 * separate lines with separate barcodes, and collapsing them into option rows
 * would invent a variant axis the supplier does not sell along.
 *
 * Prices are stored INCLUSIVE of VAT, which is this store's convention (see
 * lib/vat.ts) — the printed "RRP incl. VAT" is what the customer pays. Both
 * printed figures are kept in their own fields so a margin check never has to
 * re-derive one from the other.
 *
 * Images come from RAK's shared Drive tree, indexed separately by
 * `crawl-rak-drive-images.cjs`: the files are named by product code, so a code
 * appearing in a filename is what pairs a picture with a row. Nothing is
 * guessed — a row with no coded image is left without one and reported, rather
 * than given a lifestyle shot of a different product.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-rak-ceramics.cjs
 *
 *   DRY=1             report what would change, write nothing
 *   LIMIT=50          stop after N rows (a rehearsal)
 *   RANGE="RAK-Joy"   only rows in that range
 *   CODES=A,B,C      only these product codes
 *   SKIP_IMAGES=1     product data only, leave galleries alone
 *   MAX_IMAGES=5      gallery cap per product
 *   CONCURRENCY=6     rows in flight at once
 */
const fs = require("fs");
const path = require("path");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const XLSX = require("xlsx");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.env.DRY === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ONLY_RANGE = String(process.env.RANGE || "").trim();
/** Re-run a named set of product codes — used to repair a handful of rows. */
const ONLY_CODES = String(process.env.CODES || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES) || 5);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 6);

const EXCEL_PATH = path.join(
  __dirname,
  "..",
  "2026 RAK Retail Price List Bathrooms.xlsx",
);
const MANIFEST_PATH = path.join(__dirname, "rak-drive-manifest.json");
/**
 * Cloudinary uploads survive between runs.
 *
 * A re-run to correct a mapping should not re-fetch two thousand pictures from
 * Drive and re-upload them, so every Drive file id that has been uploaded is
 * remembered with the URL it became.
 */
const UPLOAD_CACHE = path.join(__dirname, ".rak-image-uploads.json");
const ROLLBACK = path.join(
  __dirname,
  "..",
  `rollback-rak-ceramics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const REPORT = path.join(__dirname, "..", "rak-import-report.json");

const BRAND_NAME = "RAK CERAMICS";
const BRAND_SLUG = "rak-ceramics";
const BRAND_UI_NAME = "Linx Square";
const BRAND_ORDER = 85;
const SOURCE = "RAK Ceramics 2026 Retail Price List (Bathrooms)";
const DEFAULT_STOCK = 100;
const VAT_RATE = 20;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => Math.round(Number(n) * 100) / 100;

function slugify(text) {
  return String(text ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Codes are compared with punctuation and case removed — RAK print both. */
const normCode = (s) =>
  String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const clean = (s) =>
  String(s ?? "")
    .replace(/[​-‍﻿⁠]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

/**
 * RAK's 50 category labels onto the site's own taxonomy.
 *
 * The site already carries a settled bathrooms taxonomy from the Noken and
 * Porcelanosa imports (`bathroom-taps/basin`, `basins/wall-hung`,
 * `shower/handshowers`…). Mapping onto it rather than inventing 50 new
 * categories is what puts RAK products in the menus and filters that already
 * exist — a new category slug would render an empty branch.
 *
 * Kitchen sinks and their taps stay in the Bathrooms department because that is
 * where this store's existing `kitchen-taps` products sit; moving them would
 * split one category across two departments.
 */
const CATEGORY_MAP = {
  "Bathroom Taps": ["bathroom-taps", "general"],
  "Commercial Taps": ["bathroom-taps", "general"],
  "Kitchen Sink Taps": ["kitchen-taps", "general"],
  "Concealed Valves": ["bathrooms", "shower"],
  "Exposed Valve": ["bathrooms", "shower"],
  "Exposed Valves": ["bathrooms", "shower"],
  "Shower Head": ["shower", "shower-heads"],
  "Shower Arm": ["shower", "arms"],
  "Shower Kit": ["shower", "shower-packs"],
  "Slide Rail Kit": ["shower", "shower-packs"],
  "Shower Glass": ["bathrooms", "shower-enclosures"],
  Dividers: ["bathrooms", "wetroom-shower-screens"],
  "Shower Tray": ["bathrooms", "shower-trays"],
  "Shower Waste": ["shower-trays", "accessories"],
  Sanitaryware: ["sanitaryware", "general"],
  "Compact Rimless Commercial": ["sanitaryware", "general"],
  Seat: ["sanitaryware", "accessories"],
  "Conceled Cistern": ["sanitaryware", "general"],
  "Concealed Cistern Frame": ["sanitaryware", "general"],
  "Cabinet Cisterns": ["sanitaryware", "general"],
  "Furniture Cisterns": ["sanitaryware", "general"],
  "Cistern Pack": ["sanitaryware", "general"],
  "Cistern Internal": ["sanitaryware", "accessories"],
  "Flush Plates": ["sanitaryware", "accessories"],
  "Wall Mounted Basin": ["basins", "wall-hung"],
  "Drop In Basin": ["basins", "recessed"],
  "Ceramic Sink": ["bathrooms", "washbasins-and-worktops"],
  Drainers: ["bathrooms", "washbasins-and-worktops"],
  "Counter Top Slab": ["bathrooms", "washbasins-and-worktops"],
  "Counter Top Wood": ["bathrooms", "washbasins-and-worktops"],
  "Counter Top Solid": ["bathrooms", "washbasins-and-worktops"],
  Furniture: ["bathroom-furniture", "wall-hung"],
  Handles: ["bathroom-furniture", "accessories"],
  Bracket: ["bathroom-furniture", "accessories"],
  Mirror: ["bathrooms", "mirrors"],
  Mirrors: ["bathrooms", "mirrors"],
  "Illuminated Mirror": ["bathrooms", "mirrors"],
  "Illuminated Mirror Cabinets": ["bathrooms", "mirrors"],
  "Mirror Cabinet": ["bathrooms", "mirrors"],
  "Magnifying Mirror": ["bathrooms", "mirrors"],
  Baths: ["bathrooms", "bathtubs"],
  "Freestanding Bath": ["bathtub", "free-standing"],
  "Bath Panels": ["bathtub", "accessories"],
  "Bathroom Accessories": ["bathrooms", "accessories"],
  Accessories: ["bathrooms", "accessories"],
  "Corner Baskets": ["bathrooms", "accessories"],
  "Grab Rails": ["bathrooms", "accessories"],
  "Hand Dryer": ["bathrooms", "accessories"],
  "Plumbing Accessories": ["bathrooms", "accessories"],
  Waste: ["bathrooms", "accessories"],
};

/**
 * Refine the two buckets RAK file most of the catalogue under.
 *
 * "Sanitaryware" covers pans, cisterns, bidets, urinals and basins alike, and
 * "Bathroom Taps" covers basin, bath, bidet and shower mixers. Left unrefined
 * the site's basin and toilet menus would be empty while one flat category
 * held four hundred products, so the description — which always states what the
 * item is — decides the sub-category.
 */
function refineTaxonomy(supplierCategory, description) {
  const text = ` ${description.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  // Whole words only: "pan" must not be found inside "bath panel", and "wc"
  // must not be found inside a product code that happens to contain it.
  const has = (...words) => words.some((w) => text.includes(` ${w} `));

  if (supplierCategory === "Sanitaryware") {
    if (has("urinal", "urinals")) return ["sanitaryware", "urinals"];
    if (has("bidet")) return ["sanitaryware", "general"];
    if (has("seat", "seats", "buffer", "buffers")) {
      return ["sanitaryware", "accessories"];
    }
    if (has("cistern", "cisterns", "flush plate", "flushplate")) {
      return ["sanitaryware", "general"];
    }
    if (has("pan", "wc", "toilet", "close coupled", "back to wall")) {
      return ["sanitaryware", "toilets"];
    }
    if (has("pedestal", "semi ped")) return ["basins", "semi-pedestal"];
    if (text.includes(" wall hung basin ") || text.includes(" wall hung washbasin ")) {
      return ["basins", "wall-hung"];
    }
    if (text.includes(" countertop basin ") || text.includes(" counter top basin ")) {
      return ["basins", "counter-top-basins"];
    }
    if (has("basin", "basins", "washbasin", "hand rinse")) {
      return ["bathrooms", "washbasins-and-worktops"];
    }
    return ["sanitaryware", "general"];
  }

  if (supplierCategory === "Bathroom Taps" || supplierCategory === "Commercial Taps") {
    if (has("bidet")) return ["bathroom-taps", "bidet"];
    // A bath/shower mixer is a bath tap that happens to feed a shower, so the
    // bath tests come first — otherwise every one of them files under Shower.
    if (
      text.includes(" bath shower mixer ") ||
      text.includes(" bath filler ") ||
      text.includes(" bath spout ") ||
      text.includes(" bath mixer ")
    ) {
      return ["bathrooms", "bathroom-taps"];
    }
    if (has("shower", "riser", "diverter")) return ["bathrooms", "shower"];
    if (has("waste", "wastes", "trap", "hose", "extension")) {
      return ["bathroom-taps", "accessories"];
    }
    return ["bathroom-taps", "basin"];
  }

  if (supplierCategory === "Furniture") {
    if (text.includes(" floor standing ") || has("floorstanding")) {
      return ["bathroom-furniture", "floor-standing"];
    }
    if (has("countertop", "worktop", "splashback") || text.includes(" counter top ")) {
      return ["bathrooms", "washbasins-and-worktops"];
    }
    if (has("mirror", "mirrors")) return ["bathrooms", "mirrors"];
    return ["bathroom-furniture", "wall-hung"];
  }

  if (supplierCategory === "Accessories" || supplierCategory === "Bathroom Accessories") {
    if (text.includes(" shower arm ")) return ["shower", "arms"];
    if (text.includes(" shower head ") || has("handset", "handshower")) {
      return ["shower", "handshowers"];
    }
    if (has("hose")) return ["shower", "flexi-hose"];
    return ["bathrooms", "accessories"];
  }

  return CATEGORY_MAP[supplierCategory] || ["bathrooms", "accessories"];
}

// ---------------------------------------------------------------------------
// Spreadsheet
// ---------------------------------------------------------------------------

const COLUMNS = {
  assemblyBom: "Assembly BOM",
  range: "Range",
  category: "Category",
  oldCode: "2023 Old Product Code",
  code: "2026 Product Code",
  barcode: "barcode",
  status: "Product Status in relation to RAK UK*",
  unit: "Unit of Measure",
  description: "Product Description",
  rrpEx: "2026 RRP excl. VAT",
  rrpInc: "2026 RRP incl. VAT",
};

function readRows() {
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  // The sheet carries two blank spacer rows above its header, so the header is
  // located by its first column rather than assumed to be row 1.
  const headerIndex = grid.findIndex(
    (row) => Array.isArray(row) && clean(row[0]) === COLUMNS.assemblyBom,
  );
  if (headerIndex < 0) throw new Error("Could not find the header row");
  const header = grid[headerIndex].map((h) => clean(h));

  const rows = [];
  for (const line of grid.slice(headerIndex + 1)) {
    if (!Array.isArray(line)) continue;
    const record = Object.fromEntries(header.map((h, i) => [h, line[i]]));
    const code = clean(record[COLUMNS.code]);
    const description = clean(record[COLUMNS.description]);
    // A row with neither a code nor a description is spreadsheet furniture.
    if (!code || !description) continue;
    rows.push({
      code,
      legacyCode: clean(record[COLUMNS.oldCode]),
      range: clean(record[COLUMNS.range]),
      // RAK leave Category empty on fifteen rows (the RAK-INGOT recessed
      // niches). Filed under Sanitaryware, which is where the merchant places
      // them — an uncategorised product would otherwise be held as Draft in
      // Shopify and reachable from no menu.
      supplierCategory: clean(record[COLUMNS.category]) || "Sanitaryware",
      barcode: clean(record[COLUMNS.barcode]),
      status: clean(record[COLUMNS.status]),
      unit: clean(record[COLUMNS.unit]),
      description,
      rrpEx: Number(record[COLUMNS.rrpEx]) || 0,
      rrpInc: Number(record[COLUMNS.rrpInc]) || 0,
      assemblyBom: /^y/i.test(clean(record[COLUMNS.assemblyBom])),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * How much a folder's pictures look like the product rather than the room.
 *
 * A gallery reads best with the packshot first: RAK file those under "Cut Outs"
 * (a cut-out on white), then room sets under "Lifestyle", and dimensioned
 * drawings under "Technical". Sorting by that keeps the first image of every
 * product a picture of the product.
 */
function imageRank(file) {
  const trail = file.trail.join("/").toLowerCase();
  if (/cut ?out/.test(trail)) return 0;
  if (/product image/.test(trail)) return 1;
  if (/lifestyle/.test(trail)) return 3;
  if (/technical|drawing/.test(trail)) return 4;
  return 2;
}

/**
 * Product code → Drive images, from the crawl manifest.
 *
 * A filename may name several codes ("RAKWBU60500 - RAKWTN60BAS1.jpg" is the
 * unit photographed with its basin), so it is indexed under each of them: it is
 * a true picture of both products. Tokens shorter than five characters are
 * ignored — "1", "2", "Black" are not product codes and would attach one
 * range's pictures to another's.
 */
function buildImageIndex(manifest) {
  const index = new Map();
  const basenames = [];
  for (const file of manifest.files) {
    if (file.type !== "image") continue;
    const base = file.name.replace(/\.[a-z0-9]+$/i, "");
    basenames.push({ file, normalized: normCode(base) });
    const tokens = new Set([
      normCode(base),
      ...base.split(/[^A-Za-z0-9]+/).filter(Boolean).map(normCode),
    ]);
    for (const token of tokens) {
      if (token.length < 5) continue;
      if (!index.has(token)) index.set(token, []);
      index.get(token).push(file);
    }
  }
  const rank = (a, b) =>
    imageRank(a) - imageRank(b) || a.name.localeCompare(b.name);
  for (const files of index.values()) files.sort(rank);
  return { index, basenames, rank };
}

/**
 * Every Drive image for one product code.
 *
 * Whole-token matching alone is not enough, because RAK's 2023 codes carry
 * hyphens: "WASWHPAN-R - RAKWTNSEAT500.jpg" splits into WASWHPAN / R /
 * RAKWTNSEAT500, so the code WASWHPAN-R is never a token of its own file and
 * eleven products came out imageless with their picture sitting right there.
 * So a code the tokeniser misses is looked for inside the whole normalised
 * filename as well.
 *
 * Only from seven characters up, and only as a contained run — never as a
 * prefix. RAK distinguish finishes by a trailing letter (RAKMOO3014 chrome,
 * RAKMOO3014B black), so prefix matching would confidently put the chrome
 * photograph on the black product.
 */
function findImagesForCode(imageIndex, codes) {
  const wanted = codes.map(normCode).filter((c) => c.length >= 5);
  for (const code of wanted) {
    const exact = imageIndex.index.get(code);
    if (exact?.length) return exact;
  }
  const long = wanted.filter((c) => c.length >= 7);
  if (!long.length) return [];
  const contained = imageIndex.basenames
    .filter((entry) => long.some((code) => entry.normalized.includes(code)))
    .map((entry) => entry.file);
  return contained.sort(imageIndex.rank);
}

function readUploadCache() {
  try {
    return JSON.parse(fs.readFileSync(UPLOAD_CACHE, "utf8"));
  } catch {
    return {};
  }
}

let uploadCache = readUploadCache();
let uploadCacheDirty = false;

function flushUploadCache() {
  if (!uploadCacheDirty) return;
  fs.writeFileSync(UPLOAD_CACHE, JSON.stringify(uploadCache, null, 2));
  uploadCacheDirty = false;
}

/**
 * Fetch a Drive image, preferring the CDN's resized copy.
 *
 * RAK's masters are 1800px CMYK TIFF-flavoured JPEGs around 2.7MB each; over
 * two thousand of them is several gigabytes moved twice for no gain, since the
 * storefront never renders above ~1600px. The CDN resizes and converts to RGB
 * on request, so `=s2000` is asked for first and the original is only pulled
 * when that is refused.
 */
async function downloadDriveImage(fileId) {
  const sources = [
    `https://lh3.googleusercontent.com/d/${fileId}=s2000`,
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
  ];
  let lastError;
  for (const url of sources) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 LinxRakImporter/1.0" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = res.headers.get("content-type") || "";
        if (!type.startsWith("image/")) throw new Error(`not an image (${type})`);
        const buffer = Buffer.from(await res.arrayBuffer());
        // A dozen files in RAK's "Fixed Heads and Arms" folder are the right
        // size but entirely zero bytes — Drive still serves them as image/jpeg,
        // and Google's own CDN 404s rather than decode them. Caught here so the
        // report says the supplier's file is corrupt instead of blaming
        // Cloudinary for rejecting it, and so a valid duplicate of the same
        // code elsewhere in the tree is still tried.
        if (!buffer.length || buffer.every((byte) => byte === 0)) {
          throw new Error("corrupt in Drive (file is all zero bytes)");
        }
        return buffer;
      } catch (error) {
        lastError = error;
        await sleep(600 * attempt);
      }
    }
  }
  throw lastError || new Error("download failed");
}

function uploadToCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "linx-living/products/rak-ceramics",
        public_id: publicId,
        overwrite: false,
        resource_type: "image",
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });
}

async function hostedImageUrl(file) {
  if (uploadCache[file.id]) return uploadCache[file.id];
  const buffer = await downloadDriveImage(file.id);
  const publicId = `${slugify(file.name.replace(/\.[a-z0-9]+$/i, ""))}-${file.id.slice(-8)}`;
  const uploaded = await uploadToCloudinary(buffer, publicId);
  uploadCache[file.id] = uploaded.secure_url;
  uploadCacheDirty = true;
  return uploaded.secure_url;
}

// ---------------------------------------------------------------------------
// Product shape
// ---------------------------------------------------------------------------

function buildDescription(row) {
  const parts = [row.description.replace(/\s*\.\s*$/, "") + "."];
  if (row.range && row.range !== row.supplierCategory) {
    parts.push(`Part of the ${row.range} range from RAK Ceramics.`);
  }
  if (row.supplierCategory) parts.push(`Category: ${row.supplierCategory}.`);
  parts.push(`Product code: ${row.code}.`);
  if (row.unit) parts.push(`Sold per ${row.unit.toLowerCase()}.`);
  parts.push("Prices shown include VAT.");
  return parts.join(" ");
}

function buildSpecs(row) {
  // Mirrored into `specs` as well as their own fields: `specs` is the one
  // product blob that already reaches Shopify (as the `linx.specs` metafield),
  // so this is what makes the price-list columns visible on the Shopify side.
  return {
    range: row.range,
    supplierCategory: row.supplierCategory,
    productCode: row.code,
    ...(row.legacyCode && row.legacyCode !== row.code
      ? { previousProductCode: row.legacyCode }
      : {}),
    ...(row.barcode ? { barcode: row.barcode } : {}),
    unitOfMeasure: row.unit,
    productStatus: row.status,
    assemblyBom: row.assemblyBom ? "Yes" : "No",
    rrpExVat: row.rrpEx,
    rrpIncVat: row.rrpInc,
    source: SOURCE,
  };
}

function buildProduct(row, brandId, taxonomy, images) {
  const [category, subCategory] = taxonomy;
  return {
    name: row.description,
    description: buildDescription(row),
    // Inc-VAT, per lib/vat.ts. A £0 line ("no charge" bath legs) is kept as a
    // real product; sync-product holds anything unpriced as Draft in Shopify
    // rather than publishing something orderable for nothing.
    price: money(row.rrpInc),
    vatRate: VAT_RATE,
    rrpIncVat: money(row.rrpInc),
    rrpExVat: money(row.rrpEx),
    images,
    brand: brandId,
    brands: [brandId],
    // No sub-brand. "Range" names one of RAK's own collections — RAK-Joy,
    // RAK-Washington — not a separate marque, and filing all hundred of them
    // as sub-brands built a navigation tree where twenty entries led to a
    // single product. The range is kept below in `rangeName` (a real schema
    // field, indexed and filterable) and in specs.range.
    subBrand: "",
    department: "bathrooms",
    category,
    subCategory,
    rangeName: row.range,
    supplierCategory: row.supplierCategory,
    productCode: row.code,
    manufacturerSku: row.code,
    supplierSku: row.code,
    legacyProductCode: row.legacyCode && row.legacyCode !== row.code ? row.legacyCode : "",
    barcode: row.barcode,
    supplierProductStatus: row.status,
    unitOfMeasure: row.unit,
    isAssemblyBom: row.assemblyBom,
    tagline: [row.range, row.supplierCategory].filter(Boolean).join(" · "),
    specs: buildSpecs(row),
    showSpecs: true,
    stock: DEFAULT_STOCK,
    stockStatus: "in_stock",
    isOutOfStock: false,
    keywords: [row.code, row.legacyCode, row.range, row.supplierCategory]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i),
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * `ranges` is reported, not stored. It used to be written to the brand as
 * `subBrands`; see the note on `subBrand` above for why it no longer is.
 */
async function ensureBrand(db, ranges) {
  const brands = db.collection("brands");
  const existing = await brands.findOne({ slug: BRAND_SLUG });
  if (existing) {
    if (!DRY) {
      await brands.updateOne(
        { _id: existing._id },
        {
          $set: {
            name: BRAND_NAME,
            uiName: BRAND_UI_NAME,
            isActive: true,
            updatedAt: new Date(),
          },
        },
      );
    }
    console.log(
      `Brand exists: ${BRAND_NAME} (${BRAND_SLUG}) — uiName "${BRAND_UI_NAME}", ${ranges.length} ranges kept as rangeName`,
    );
    return { id: existing._id, created: false, previous: existing };
  }

  const doc = {
    name: BRAND_NAME,
    slug: BRAND_SLUG,
    uiName: BRAND_UI_NAME,
    order: BRAND_ORDER,
    isActive: true,
    image: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (DRY) {
    console.log(`[dry] would create brand ${BRAND_NAME}; ${ranges.length} ranges kept as rangeName`);
    return { id: null, created: true, previous: null };
  }
  const result = await brands.insertOne(doc);
  console.log(
    `Created brand: ${BRAND_NAME} (${BRAND_SLUG}) — uiName "${BRAND_UI_NAME}", ${ranges.length} ranges kept as rangeName`,
  );
  return { id: result.insertedId, created: true, previous: null };
}

async function main() {
  for (const key of [
    "MONGODB_URI",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ]) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      `No Drive manifest at ${MANIFEST_PATH} — run scripts/crawl-rak-drive-images.cjs first`,
    );
  }

  console.log(`Reading ${path.basename(EXCEL_PATH)}…`);
  let rows = readRows();
  console.log(`  ${rows.length} priced rows`);

  const ranges = [...new Set(rows.map((r) => r.range).filter(Boolean))];
  if (ONLY_RANGE) {
    rows = rows.filter((r) => r.range === ONLY_RANGE);
    console.log(`  filtered to range "${ONLY_RANGE}": ${rows.length} rows`);
  }
  if (ONLY_CODES.length) {
    rows = rows.filter((r) => ONLY_CODES.includes(r.code.toUpperCase()));
    console.log(`  filtered to ${ONLY_CODES.length} code(s): ${rows.length} rows`);
  }
  if (rows.length > LIMIT) rows = rows.slice(0, LIMIT);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const imageIndex = buildImageIndex(manifest);
  console.log(
    `  Drive manifest: ${manifest.files.length} files, ${imageIndex.index.size} codes indexed`,
  );

  console.log("Connecting to Mongo…");
  const conn = await connectMongo();
  const db = conn.db;
  const products = db.collection("products");

  const brand = await ensureBrand(db, ranges);

  const report = {
    source: SOURCE,
    startedAt: new Date().toISOString(),
    dryRun: DRY,
    rows: rows.length,
    created: 0,
    updated: 0,
    withImages: 0,
    imagesUploaded: 0,
    withoutImages: [],
    errors: [],
    taxonomy: {},
  };
  const rollback = [];
  let done = 0;

  async function handle(row) {
    const taxonomy = refineTaxonomy(row.supplierCategory, row.description);
    const key = `${taxonomy[0]}/${taxonomy[1]}`;
    report.taxonomy[key] = (report.taxonomy[key] || 0) + 1;

    // A product is identified by its code within this brand. Matching on name
    // would merge the "in Grey" and "in Black" rows of anything RAK describe
    // identically, and matching on code alone could collide with another
    // supplier reusing a short code.
    const existing = await products.findOne({
      productCode: row.code,
      $or: [{ brand: brand.id }, { brands: brand.id }],
    });

    let images = existing?.images ?? [];
    let uploaded = 0;
    if (!SKIP_IMAGES) {
      const candidates = findImagesForCode(imageIndex, [
        row.code,
        row.legacyCode,
      ].filter(Boolean));
      if (candidates.length) {
        const urls = [];
        for (const file of candidates.slice(0, MAX_IMAGES)) {
          try {
            const cached = Boolean(uploadCache[file.id]);
            urls.push(DRY ? `drive:${file.id}` : await hostedImageUrl(file));
            if (!cached) uploaded++;
          } catch (error) {
            report.errors.push({
              code: row.code,
              image: file.name,
              error: error.message,
            });
          }
        }
        if (urls.length) images = urls;
      }
    }
    if (images.length) report.withImages++;
    else {
      report.withoutImages.push({
        code: row.code,
        range: row.range,
        category: row.supplierCategory,
        name: row.description,
      });
    }
    report.imagesUploaded += uploaded;

    const doc = buildProduct(row, brand.id, taxonomy, images);
    const now = new Date();

    if (DRY) {
      if (done < 5) {
        console.log(
          `[dry] ${existing ? "update" : "create"} ${row.code} · ${key} · £${doc.price} · ${images.length} image(s)`,
        );
      }
      existing ? report.updated++ : report.created++;
      return;
    }

    if (existing) {
      rollback.push({ _id: String(existing._id), before: existing });
      await products.updateOne(
        { _id: existing._id },
        { $set: { ...doc, updatedAt: now } },
      );
      report.updated++;
    } else {
      const result = await products.insertOne({
        ...doc,
        createdAt: now,
        updatedAt: now,
      });
      rollback.push({ _id: String(result.insertedId), before: null });
      report.created++;
    }
  }

  const queue = [...rows];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const row = queue.shift();
      try {
        await handle(row);
      } catch (error) {
        report.errors.push({ code: row.code, error: error.message });
      }
      done++;
      if (done % 50 === 0) {
        flushUploadCache();
        console.log(
          `  ${done}/${rows.length} · created ${report.created} · updated ${report.updated} · images uploaded ${report.imagesUploaded}`,
        );
      }
    }
  });
  await Promise.all(workers);
  flushUploadCache();

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  if (!DRY && rollback.length) {
    fs.writeFileSync(ROLLBACK, JSON.stringify(rollback, null, 2));
  }

  console.log("\n========== RAK CERAMICS IMPORT ==========");
  console.log(`Rows:            ${report.rows}`);
  console.log(`Created:         ${report.created}`);
  console.log(`Updated:         ${report.updated}`);
  console.log(`With images:     ${report.withImages}`);
  console.log(`Without images:  ${report.withoutImages.length}`);
  console.log(`Images uploaded: ${report.imagesUploaded}`);
  console.log(`Errors:          ${report.errors.length}`);
  console.log(`\nTaxonomy:`);
  for (const [key, n] of Object.entries(report.taxonomy).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${key}`);
  }
  console.log(`\nReport:   ${REPORT}`);
  if (!DRY && rollback.length) console.log(`Rollback: ${ROLLBACK}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  flushUploadCache();
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

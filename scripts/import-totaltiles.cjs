/**
 * Import the Total Tiles capture (.scratch/totaltiles/tt-pdp.jsonl) into Mongo.
 *
 * Strict rules for this brand (same as import-al-murad.cjs):
 *
 *  - INSERT ONLY. Every product this script writes is a brand-new document.
 *    It never runs updateOne / updateMany / bulkWrite / deleteOne against an
 *    existing row. A product whose `sourceUrl` is already held in EITHER
 *    cluster is skipped, not overwritten. Re-running is always safe.
 *  - NO NEW CATEGORIES. Every target department/category below was verified
 *    to already exist via `distinct("category",{department})` on both clusters
 *    before writing this table. Nothing here is a new slug.
 *  - Stock is fixed at 500 (STOCK_DEFAULT) for every product.
 *  - Images stay as TotalTiles CDN URLs in `images[]` until
 *    shopify-harvest-brand-images.cjs THEN_REWRITE=1 replaces them with
 *    Shopify CDN URLs. No supplier URLs should remain after that pass.
 *  - Brand.dataCluster = "secondary" (confirmed: secondary has 19,431 docs
 *    vs primary's 28,038 — secondary has headroom).
 *
 * Spec key aliases (CRITICAL — without these the frontend coverage calculator
 * silently shows zero/undefined for every tile product):
 *  - scraped "Tiles per square meter" → specs.tilesPerSqm
 *    (page.tsx line 885 reads pickSpec(specs, "tilesPerSqm"))
 *  - scraped "Coverage (m²) .approx" → specs.packCoverageM2
 *    (page.tsx line 848 reads pickSpec(specs, "packCoverageM2"))
 *  - priceCurrentPerSqm → specs.pricePerM2
 *    (page.tsx line 826 reads pickSpec(specs, "pricePerM2"))
 *
 * Exclusions:
 *  - 9 products with null priceCurrent: these are parent/configurable pages
 *    where TotalTiles shows no price until a variant is chosen. Their sized
 *    siblings (1L, 5L, specific mat-size variants) are all in the JSONL with
 *    real prices and are imported. Importing the parent with price=0 would
 *    be misleading.
 *  - RRP nulled out for any product where priceCurrent > priceRRP (10 cases,
 *    all accessories/sealers with stale listed RRPs or unit-mismatched bundles).
 *
 * Env:
 *   TT_DATA=path    capture directory (default: .scratch/totaltiles)
 *   DRY_RUN=1       parse and report, write nothing
 *   LIMIT=n         only first n records
 *   ACTIVATE=1      set brand live once done (default: off = DRAFT)
 */
"use strict";

const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ACTIVATE = process.env.ACTIVATE === "1";

const TT_DATA =
  process.env.TT_DATA ||
  path.join(__dirname, "..", ".scratch", "totaltiles");
const PDP_FILE = path.join(TT_DATA, "tt-pdp.jsonl");

const BRAND_NAME = "Total Tiles";
const BRAND_SLUG = "total-tiles";
const SOURCE_TAG = "totaltiles-scrape";
const STOCK_DEFAULT = 500;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const toFloat = (s) => {
  const n = parseFloat(String(s || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ─── Category mapping ──────────────────────────────────────────────────────────
//
// Strategy: walk the breadcrumb array and pick the FIRST item whose name
// matches an entry in this map (top-down).  A few breadcrumbs start with
// "Tiles" → "Floor Tiles" — we resolve on the more specific bc[1] if
// it maps, otherwise fall back to bc[0].
//
// Every target here was verified against `distinct("category",{department})`
// on both clusters.  Nothing new is introduced.
//
// Confirmed existing tiles categories: floor-tiles, luxury-wall-tiles,
//   outdoor-tiles, mosaic-tiles, bathroom-tiles, kitchen-tiles,
//   natural-stone-effect-tiles, patterned-tiles, porcelain-tiles,
//   floor-tiles (for wood-effect and concrete-effect).
// Confirmed existing accessories categories: accessories.
// UFH: no "underfloor-heating" department exists in DB → map to accessories.

const CATEGORY_MAP = {
  // ─── Tile department ──────────────────────────────────────────────
  "Tiles": { department: "tiles", category: "floor-tiles" }, // fallback for bare "Tiles" top-level
  "Floor Tiles": { department: "tiles", category: "floor-tiles" },
  "Wall Tiles": { department: "tiles", category: "luxury-wall-tiles" },
  "Bathroom Tiles": { department: "tiles", category: "bathroom-tiles" },
  "Bathroom Wall Tiles": { department: "tiles", category: "bathroom-tiles" },
  "Bathroom Floor Tiles": { department: "tiles", category: "bathroom-tiles" },
  "Kitchen Tiles": { department: "tiles", category: "kitchen-tiles" },
  "Kitchen Floor Tiles": { department: "tiles", category: "kitchen-tiles" },
  "Outdoor Tiles": { department: "tiles", category: "outdoor-tiles" },
  "Matching Indoor Outdoor Tiles": { department: "tiles", category: "outdoor-tiles" },
  "Matching Wall and Floor Tiles": { department: "tiles", category: "floor-tiles" },
  "Matching Wall And Floor Tiles": { department: "tiles", category: "floor-tiles" },
  "Stone Effect Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  "Marble Effect Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  "Marble Effect Floor Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  "Concrete Effect Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  "Wood Effect Tiles": { department: "tiles", category: "floor-tiles" },
  "Patterned Tiles": { department: "tiles", category: "patterned-tiles" },
  "Mosaic Tiles": { department: "tiles", category: "mosaic-tiles" },
  "Mosaics": { department: "tiles", category: "mosaic-tiles" },
  "Mosaics Bathroom Tiles": { department: "tiles", category: "mosaic-tiles" },
  "Feature Wall Tiles": { department: "tiles", category: "luxury-wall-tiles" },
  "Slate Effect Floor Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  "Grey Floor Tiles": { department: "tiles", category: "floor-tiles" },
  "White Marble Effect Floor Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  // Johnson Tiles sub-nav — manufacturer range, always tiles
  "Johnson Tiles": { department: "tiles", category: "porcelain-tiles" },
  "Johnson Tiles Chroma Collection": { department: "tiles", category: "luxury-wall-tiles" },
  "Johnson Tiles Hudson Collection": { department: "tiles", category: "floor-tiles" },
  "Johnson Tiles Polar Collection": { department: "tiles", category: "luxury-wall-tiles" },
  "Johnson Tiles Classics Collection": { department: "tiles", category: "luxury-wall-tiles" },
  // Inspire Me = editorial, underlying product is still a tile
  "Inspire Me": { department: "tiles", category: "floor-tiles" },
  // Named ranges — classify by title keyword in resolveCategory
  // Quarry tiles are floor tiles
  "Quarry Floor Tiles": { department: "tiles", category: "floor-tiles" },
  // LVT is flooring but Total Tiles has none that reach here — leave as tiles
  "Ashdown Rigid Core LVT Flooring": { department: "flooring", category: "luxury-vinyl-tile" },
  "Kingsford Rigid Core LVT Flooring": { department: "flooring", category: "luxury-vinyl-tile" },
  // Skirting tiles → luxury-wall-tiles (trim pieces)
  "Skirting Tiles": { department: "tiles", category: "luxury-wall-tiles" },
  // Promotional / clearance nodes — skip as primary category, rely on title
  "New In": { skip: true },
  "SALE": { skip: true },
  "Pallet Deals": { skip: true },
  "Clearance Wall Tile Lines": { skip: true },
  "Tiles with FREE cut samples": { skip: true },

  // ─── Accessories department ──────────────────────────────────────
  "Accessories": { department: "accessories", category: "accessories" },
  "Tile Accessories": { department: "accessories", category: "accessories" },
  "Tile Trims": { department: "accessories", category: "accessories" },
  "No More Ply": { department: "accessories", category: "accessories" },
  "Tiling Tools": { department: "accessories", category: "accessories" },
  "Tile Cutters": { department: "accessories", category: "accessories" },
  "Tile Drill Bits": { department: "accessories", category: "accessories" },
  "Tile Spacers": { department: "accessories", category: "accessories" },
  "Silicone": { department: "accessories", category: "accessories" },
  "Self Levelling Compound": { department: "accessories", category: "accessories" },
  "Anti Crack Systems": { department: "accessories", category: "accessories" },

  // ─── Adhesive & Grout → accessories ────────────────────────────
  "Adhesive & Grout": { department: "accessories", category: "accessories" },
  "Tile Adhesive": { department: "accessories", category: "accessories" },
  "Tile Grout": { department: "accessories", category: "accessories" },
  "Flexible Mould Resistant Wall & Floor Grout": { department: "accessories", category: "accessories" },
  "Tile Sealers & Cleaners": { department: "accessories", category: "accessories" },
  "Preparation": { department: "accessories", category: "accessories" },

  // ─── Underfloor Heating → accessories (no UFH dept in DB) ───────
  "Underfloor Heating": { department: "accessories", category: "accessories" },
  "Underfloor Heating Controls": { department: "accessories", category: "accessories" },
  "Underfloor Heating Insulation": { department: "accessories", category: "accessories" },
  "200 W/M² Under Tile Heating Mat": { department: "accessories", category: "accessories" },
  "150 W/M² Under Tile Heating Mat": { department: "accessories", category: "accessories" },
  "Under Tile Heating Loose Cable": { department: "accessories", category: "accessories" },
  "Laminate & Wood Floor Heating": { department: "accessories", category: "accessories" },
};

/**
 * Keyword fallback for the 37 thin-breadcrumb products (≤1 item) and any
 * product whose entire breadcrumb chain resolves only to skip-only nodes.
 * Applied only after all breadcrumb-based mapping attempts fail.
 */
function keywordFallback(title) {
  const t = String(title || "").toLowerCase();
  if (/adhesive|bonding/.test(t)) return { department: "accessories", category: "accessories" };
  if (/grout/.test(t)) return { department: "accessories", category: "accessories" };
  if (/sealer|cleaner|stripper|mouldex|grimex|ironwax|mattstone|stoneseal|mpg polish|colour intensifier/.test(t)) {
    return { department: "accessories", category: "accessories" };
  }
  if (/backer board|backboard/.test(t)) return { department: "accessories", category: "accessories" };
  if (/scraper|blade|trowel|spacer|drill bit|cutter|float/.test(t)) {
    return { department: "accessories", category: "accessories" };
  }
  if (/underfloor heating|heating mat|heating cable|thermostat|heating kit/.test(t)) {
    return { department: "accessories", category: "accessories" };
  }
  if (/mosaic/.test(t)) return { department: "tiles", category: "mosaic-tiles" };
  if (/outdoor|external|paver/.test(t)) return { department: "tiles", category: "outdoor-tiles" };
  if (/wall tile/.test(t)) return { department: "tiles", category: "luxury-wall-tiles" };
  if (/floor tile/.test(t)) return { department: "tiles", category: "floor-tiles" };
  if (/porcelain|ceramic|tile/.test(t)) return { department: "tiles", category: "floor-tiles" };
  return null;
}

/**
 * Resolve {department, category} for a product given its breadcrumb array.
 *
 * Walk the breadcrumb from [0] through [-2] (stop before the product-name node).
 * Return the FIRST non-skip match.  If everything resolves to skip nodes or
 * nothing maps, fall back to keywordFallback on the title.
 */
function resolveCategory(breadcrumb, title) {
  const bc = breadcrumb || [];
  // The last element is the product itself — exclude it
  const navNodes = bc.slice(0, Math.max(bc.length - 1, 0));

  let skipped = false;
  for (const node of navNodes) {
    const name = (node.name || "").trim();
    const mapped = CATEGORY_MAP[name];
    if (mapped) {
      if (mapped.skip) { skipped = true; continue; }
      return mapped;
    }
    // Named range nodes (e.g. "Provence Stone Effect Porcelain") — not in map,
    // but they're under "Tiles" → use title keyword or continue looking
  }

  // Try named-range resolution: if any nav node contains tile-type keywords
  for (const node of navNodes) {
    const name = (node.name || "").toLowerCase();
    if (/mosaic/.test(name)) return { department: "tiles", category: "mosaic-tiles" };
    if (/outdoor|external|paver/.test(name)) return { department: "tiles", category: "outdoor-tiles" };
    if (/wood effect|parquet/.test(name)) return { department: "tiles", category: "floor-tiles" };
    if (/marble effect|stone effect|concrete effect|slate effect/.test(name)) {
      return { department: "tiles", category: "natural-stone-effect-tiles" };
    }
    if (/pattern/.test(name)) return { department: "tiles", category: "patterned-tiles" };
    if (/bathroom/.test(name)) return { department: "tiles", category: "bathroom-tiles" };
    if (/kitchen/.test(name)) return { department: "tiles", category: "kitchen-tiles" };
    if (/wall tile/.test(name)) return { department: "tiles", category: "luxury-wall-tiles" };
    if (/floor tile|quarry/.test(name)) return { department: "tiles", category: "floor-tiles" };
    if (/porcelain|ceramic|tile/.test(name)) return { department: "tiles", category: "floor-tiles" };
  }

  // Last resort: keyword match on product title
  return keywordFallback(title) || null;
}

// ─── Description builder ──────────────────────────────────────────────────────
// PDP splits a plain-text description on "\n" into a lead paragraph + bulleted
// list (ProductDetailTabs.tsx). The marketing overview is the lead; specs follow
// one per line as "Label: value" pairs.
function buildDescription(description, specs) {
  const specLines = Object.entries(specs)
    // Exclude internal alias keys we add ourselves — not meaningful to display
    .filter(([k]) => !["source", "importedAt", "tilesPerSqm", "packCoverageM2",
                         "pricePerM2", "sqmPerBox", "unit", "priceUnit"].includes(k))
    .map(([k, v]) => `${k}: ${v}`);

  if (specLines.length === 0) {
    // Accessories/tools with only marketing copy — return prose as-is
    return clean(description) || "";
  }

  const lead = clean(description);
  return (lead ? lead + "\n" : "") + specLines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(PDP_FILE)) {
    throw new Error(
      "no capture at " + PDP_FILE + " — run scripts/capture-totaltiles.cjs first"
    );
  }

  const { db: primary } = await connectMongo();

  // ── 1. Upsert brand document (always in primary, brand.dataCluster tells us
  //       where products go).
  let brand = await primary.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) {
    if (DRY_RUN) {
      console.log("[dry] would create brand " + BRAND_NAME + " (dataCluster: secondary)");
      brand = { _id: new mongoose.Types.ObjectId(), dataCluster: "secondary" };
    } else {
      const res = await primary.collection("brands").insertOne({
        name: BRAND_NAME,
        slug: BRAND_SLUG,
        dataCluster: "secondary",
        isActive: ACTIVATE,
        order: 0,
        subBrands: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      brand = { _id: res.insertedId, dataCluster: "secondary" };
      console.log(
        "created brand " + BRAND_NAME +
        " (" + brand._id + ", secondary cluster, isActive=" + ACTIVATE + ")"
      );
    }
  } else {
    console.log("brand already exists: " + BRAND_NAME + " (" + brand._id + ")");
  }

  // ── 2. Open secondary cluster connection for product writes.
  let secConn = null;
  let db = primary;
  if (brand.dataCluster === "secondary") {
    secConn = await mongoose
      .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
      .asPromise();
    db = secConn.db;
    console.log("products go to: SECONDARY cluster");
  } else {
    console.log("products go to: PRIMARY cluster");
  }

  const productsCol = db.collection("products");

  // ── 3. Count before write (safety check).
  const countBefore = DRY_RUN ? 0 : await productsCol.countDocuments();

  // ── 4. Load all existing TotalTiles sourceUrls from BOTH clusters so we
  //       never double-insert even if a previous partial run landed on the
  //       wrong cluster.
  const primaryProducts = primary.collection("products");
  const existing = new Set();
  for (const col of [primaryProducts, productsCol]) {
    for await (const row of col
      .find({ sourceUrl: /totaltiles\.co\.uk/i })
      .project({ sourceUrl: 1 })) {
      existing.add(row.sourceUrl);
    }
  }
  console.log("already in Mongo (either cluster): " + existing.size + " TotalTiles products");

  // ── 5. Process records.
  const lines = fs.readFileSync(PDP_FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  console.log("capture holds " + lines.length + " records");

  let created = 0;
  let skippedExisting = 0;
  let skippedNullPrice = 0;
  let skippedError = 0;
  let noCategoryBucket = 0;
  const catCount = new Map();
  const unmappedUrls = [];
  let ops = [];

  const flush = async () => {
    if (!ops.length) return;
    const batch = ops;
    ops = [];
    if (!DRY_RUN) await productsCol.insertMany(batch, { ordered: false });
  };

  let processed = 0;
  for (const line of lines) {
    if (processed >= LIMIT) break;

    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      skippedError++;
      continue;
    }

    // Skip explicit scrape errors
    if (rec.status && rec.status !== 200) {
      skippedError++;
      continue;
    }

    // Skip if no title (degenerate record)
    if (!rec.title) {
      skippedError++;
      continue;
    }

    processed++;

    // ── Dedupe against both clusters ──
    if (existing.has(rec.url)) {
      skippedExisting++;
      continue;
    }

    // ── Exclude null-price products (configurable parent pages with no price
    //    rendered until a variant is selected on the live site) ──
    if (rec.priceCurrent == null) {
      skippedNullPrice++;
      if (DRY_RUN) {
        console.log("  [dry] skip (null price): " + rec.title.slice(0, 70));
      }
      continue;
    }

    // ── Category mapping ──
    const bucket = resolveCategory(rec.breadcrumb, rec.title);
    if (!bucket) {
      noCategoryBucket++;
      unmappedUrls.push(rec.url);
      if (DRY_RUN) console.log("  [dry] NO CATEGORY: " + rec.title.slice(0, 70) + " | bc=" + JSON.stringify((rec.breadcrumb||[]).map(b=>b.name)));
      continue;
    }
    catCount.set(
      bucket.department + "/" + bucket.category,
      (catCount.get(bucket.department + "/" + bucket.category) || 0) + 1
    );

    // ── Price / RRP handling ──
    const priceCurrent = rec.priceCurrent;
    const priceCurrentPerSqm = rec.priceCurrentPerSqm || null;

    // Null out RRP if price >= RRP (stale listed RRP, or unit-mismatched bundle)
    // Also null out if RRP itself is missing
    let priceRRP = rec.priceRRP || null;
    let priceRRPPerSqm = rec.priceRRPPerSqm || null;
    if (priceRRP != null && priceCurrent >= priceRRP) {
      priceRRP = null;
      priceRRPPerSqm = null;
    }

    // ── Specs: scrape the raw table + add calculator aliases ──
    const rawSpecs = rec.specs || {};

    // Keys the source site uses:
    const tilesPerSqmRaw = toFloat(rawSpecs["Tiles per square meter"]);

    // "Coverage (m²) .approx" appears on BOTH tile products AND adhesive/grout
    // bags. On tiles it means pack coverage (alias → packCoverageM2, feeds the
    // area calculator). On adhesives it means how many m² one bag covers as a
    // working material — a completely different concept. The two are fully
    // disjoint: tile products have "Tiles per square meter", adhesives never do.
    // Only alias to packCoverageM2 when it's a tile product (tilesPerSqmRaw set).
    const isTileProduct = tilesPerSqmRaw != null;
    const packCoverageRaw = isTileProduct
      ? toFloat(rawSpecs["Coverage (m²) .approx"])
      : null;

    // sqmPerBox: total m² one unit-of-purchase covers.
    // For tile products sold individually (no pack coverage), one tile covers
    // 1/tilesPerSqm m² — the coverage calculator needs this to compute price/m².
    // For products with explicit pack coverage, use that directly.
    const sqmPerBox = packCoverageRaw ||
      (tilesPerSqmRaw ? Number((1 / tilesPerSqmRaw).toFixed(4)) : null);

    // pricePerM2: only meaningful for tile products (not adhesives or tools).
    // Use the scraped per-m² price if available (TotalTiles shows it on-page).
    // Fall back to priceCurrent / sqmPerBox if we computed sqmPerBox.
    const pricePerM2 = isTileProduct
      ? (priceCurrentPerSqm ||
         (sqmPerBox && sqmPerBox > 0
           ? Number((priceCurrent / sqmPerBox).toFixed(2))
           : null))
      : null;

    // SKU: scrape from specs["SKU"], fall back to rec.sku
    const sku = rawSpecs["SKU"] || rec.sku || "";

    // Build the merged specs object: raw table first, then calculator aliases
    const specs = Object.assign({}, rawSpecs, {
      source: SOURCE_TAG,
      importedAt: new Date().toISOString(),

      // Calculator alias: tilesPerSqm (page.tsx line 885)
      ...(tilesPerSqmRaw ? { tilesPerSqm: tilesPerSqmRaw } : {}),

      // Calculator alias: packCoverageM2 (page.tsx line 848)
      ...(packCoverageRaw ? { packCoverageM2: packCoverageRaw } : {}),

      // Calculator alias: sqmPerBox (page.tsx line 809) — used to derive
      // price/m² when pricePerM2 is not directly available
      ...(sqmPerBox ? { sqmPerBox } : {}),

      // Calculator alias: pricePerM2 (page.tsx line 826)
      ...(pricePerM2 ? { pricePerM2 } : {}),

      // SKU in specs bag (page.tsx line 804)
      sku,
      productCode: sku,
    });

    // ── Description ──
    const description = buildDescription(rec.description, rawSpecs);

    // ── Dimensions from specs ──
    const widthMm = toFloat(rawSpecs["Width"]);
    const heightMm = toFloat(rawSpecs["Height"]);
    const thicknessMm = toFloat(rawSpecs["Thickness (mm)"]);
    const sizeLabel = widthMm && heightMm
      ? widthMm + "mm x " + heightMm + "mm"
      : "";

    // ── Stock ──
    const isOutOfStock = /out\s*of\s*stock/i.test(rec.stockStatus || "");

    const now = new Date();

    const doc = {
      // Identity
      name: clean(rec.title),
      description,
      shortDescription: "",

      // Pricing — all in GBP inc-VAT (TotalTiles shows inc-VAT prices)
      price: priceCurrent,
      priceCurrency: "GBP",
      rrpIncVat: priceRRP,  // null if stale/impossible
      specialPrice: null,   // TotalTiles shows current as the real price already

      // Unit of measure — derive from whether the product has m² pricing
      unitOfMeasure: priceCurrentPerSqm ? "m²" : "Each",

      // Images (supplier URLs — replaced by Shopify CDN URLs after harvest)
      images: rec.images || [],

      // Taxonomy
      department: bucket.department,
      category: bucket.category,
      categories: [bucket.category],
      subCategory: "",
      subCategories: [],
      sourceCategories: (rec.breadcrumb || [])
        .filter((b, i) => i < (rec.breadcrumb||[]).length - 1) // exclude product node
        .map((b) => ({ name: b.name })),

      // Brand
      brand: brand._id,
      brands: [brand._id],
      subBrand: "",

      // Product attributes
      supplierSku: sku,
      productCode: sku,
      finish: rawSpecs["Appearance"] || rawSpecs["Texture"] || "",
      materials: [rawSpecs["Material"]].filter(Boolean),
      colours: [rawSpecs["Colour"]].filter(Boolean),
      colorOptions: [],
      sizeOptions: [],
      variantGroups: [],

      dimensions: sizeLabel ? { size: sizeLabel } : {},
      thickness: thicknessMm ? String(thicknessMm) + "mm" : (rawSpecs["Thickness (mm)"] || ""),

      // Pack/coverage
      packCoverageM2: packCoverageRaw || null,
      piecesPerPack: null,

      // Stock
      stock: STOCK_DEFAULT,
      isOutOfStock,
      stockStatus: isOutOfStock ? "out_of_stock" : "in_stock",

      // Attributes (for display in spec table)
      attributes: Object.entries(rawSpecs)
        .filter(([k]) => k !== "SKU") // SKU already in top-level fields
        .map(([label, value]) => ({ label, value: String(value) })),

      // Source tracking
      sourceUrl: rec.url,
      sourceHandle: rec.url.split("/").pop().replace(/\.html$/, ""),
      sourceProductId: sku,
      sourceSku: sku,
      canonicalUrl: rec.url,

      // Free-form specs bag with calculator aliases (see comment at top of file)
      specs,

      badges: [],

      createdAt: now,
      updatedAt: now,
      priceSyncedAt: now,
      stockSyncedAt: now,
    };

    if (DRY_RUN) {
      created++;
      if (created <= 10) {
        console.log(
          "  [dry] " + doc.name.slice(0, 65) +
          "\n        GBP " + doc.price +
          (priceRRPPerSqm ? " (RRP/m² £" + priceRRPPerSqm + ")" : "") +
          " | " + doc.department + "/" + doc.category +
          " | imgs=" + doc.images.length +
          " | specs=" + Object.keys(rawSpecs).length +
          (tilesPerSqmRaw ? " | tiles/m²=" + tilesPerSqmRaw : "") +
          (pricePerM2 ? " | £/m²=" + pricePerM2 : "")
        );
      }
      continue;
    }

    ops.push(doc);
    created++;
    if (ops.length >= 200) await flush();
  }

  await flush();

  // ── 6. Safety check: collection delta must equal exactly what we inserted ──
  if (!DRY_RUN) {
    const countAfter = await productsCol.countDocuments();
    const delta = countAfter - countBefore;
    if (delta !== created) {
      throw new Error(
        `SAFETY CHECK FAILED: collection grew by ${delta} documents but this run only ` +
        `inserted ${created}. Something else wrote to this collection concurrently — ` +
        `stopping rather than reporting a false success.`
      );
    }
    console.log(
      `\nsafety check passed: secondary collection ${countBefore} → ${countAfter} (+${delta}, matches inserts exactly)`
    );
  }

  // ── 7. Final report ──
  const prefix = DRY_RUN ? "[dry] " : "";
  console.log("\n" + prefix + "created:                   " + created);
  console.log(prefix + "skipped (already existed): " + skippedExisting);
  console.log(prefix + "skipped (null price):      " + skippedNullPrice);
  console.log(prefix + "skipped (scrape error):    " + skippedError);
  console.log(prefix + "skipped (no category):     " + noCategoryBucket);

  if (unmappedUrls.length) {
    console.log("\nProducts with no mappable category (manual review needed):");
    unmappedUrls.forEach((u) => console.log("  " + u));
  }

  console.log("\nBy category:");
  for (const [k, v] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(k).padEnd(35) + v);
  }

  if (secConn) await secConn.close();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e.message || e);
    process.exit(1);
  });

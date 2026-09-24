/**
 * Import the Walls and Floors capture (scripts/capture-wallsandfloors.cjs)
 * into Mongo.
 *
 * Same strict rules as Al Murad (see scripts/import-al-murad.cjs and
 * scripts/PLAYBOOK-brand-scrape-import.md):
 *  - INSERT ONLY. No updateOne/updateMany/bulkWrite/deleteOne against
 *    `products` anywhere in this script. Dedupe against `sourceUrl` in
 *    BOTH clusters before every insert. Document-count safety check.
 *  - NO NEW CATEGORIES. CATEGORY_MAP below maps every WF category slug
 *    this brand actually uses onto a category slug that already exists on
 *    the site today (verified against distinct("category", {department})
 *    on both clusters). Fencing products (Luxeline composite fence panels
 *    — no matching category exists at all) go to wall-panels/claddings
 *    per explicit instruction, not a new "fencing" category.
 *  - Stock fixed at 500 for every product.
 *  - Price: real public price from the site's own JSON-LD (no gating on
 *    this site, unlike Trade Choice/Domus Group).
 *  - Images: WF's own CDN URLs seed images[]; a later Shopify push +
 *    harvest pass rewrites this to Shopify CDN URLs only.
 *  - description: one spec per line ("\n"-joined), matching how the PDP's
 *    ProductDetailTabs renders a plain-text description (lead line +
 *    bulleted list) — never ". "-joined (see the Al Murad post-mortem in
 *    the playbook for why this was a real bug, not a style choice).
 *
 * Env:
 *   DRY_RUN=1      parse and report, write nothing
 *   LIMIT=n        only the first n captured products
 *   ACTIVATE=1     set the brand live once the import succeeds (default: off)
 */
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

const DATA_DIR = path.join(__dirname, "..", ".scratch", "wallsandfloors");
const PDP_FILE = path.join(DATA_DIR, "wf-pdp.jsonl");

const BRAND_NAME = "Walls and Floors";
const BRAND_SLUG = "walls-and-floors";
const SOURCE_TAG = "wallsandfloors-scrape";
const STOCK_DEFAULT = 500;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Walls and Floors' own category vocabulary is ~720 slugs deep (mostly
 * colour/size/style facets layered on top of a much smaller set of real
 * taxonomy nodes — the same "cross-listed under many filters" pattern as
 * Al Murad). Rather than a 1:1 table, this matches by KEYWORD against the
 * product's full `categories[]` array (every filter it's cross-listed
 * under), checked in priority order — a product carrying ANY of a
 * bucket's trigger words in ANY of its category slugs gets that bucket.
 * First match wins per product; order matters (more specific first).
 */
const KEYWORD_BUCKETS = [
  // Wall-panel / fencing checked FIRST: "bathroom"/"kitchen"/"shower" in a
  // WF category tag are ROOM CONTEXT ("wall-panels/bathroom",
  // "wall-panels/shower-panels/pvc-wall-panels"), not product type — a
  // Trepanel shower panel is still a wall panel, not a tile. Checking the
  // room-context rules first wrongly filed 95 wall panels as
  // tiles/bathroom-tiles (confirmed real bug), which also broke their PDP
  // calculator: several department/category-gated special-case
  // configurators only apply to `department: "tiles"`.
  // \bslat\b, not bare "slat" — that also matched inside "slate" (a stone
  // material — "interior-slate-tiles" wrongly pulled real tile products
  // like "Crystal Arctic Grey Split Face Tiles" into wall-panels).
  { test: /wall-panel|wall-cladding|\bslats?\b|trepanel|wood-wall-panel/, department: "wall-panels", category: "claddings" },
  // Composite fence panels (Luxeline) have no matching category anywhere
  // on the site at all — explicit user instruction: file under
  // wall-panels/claddings (an existing category) rather than invent a new
  // "fencing" one.
  { test: /^fencing/, department: "wall-panels", category: "claddings" },
  { test: /bathroom|wetroom|wet-room|cloakroom|shower/, department: "tiles", category: "bathroom-tiles" },
  { test: /kitchen|splashback/, department: "tiles", category: "kitchen-tiles" },
  { test: /\bbrick\b|\bmetro\b/, department: "tiles", category: "brick-tiles" },
  { test: /\bmosaic\b/, department: "tiles", category: "mosaic-tiles" },
  { test: /paving-slab|garden-slab/, department: "tiles", category: "paving-slabs" },
  { test: /outdoor|swimming-pool|anti-slip/, department: "tiles", category: "outdoor-tiles" },
  { test: /stone-effect|marble|travertine|slate|carrara/, department: "tiles", category: "natural-stone-effect-tiles" },
  { test: /victorian|patterned|border-tiles|moroccan/, department: "tiles", category: "patterned-tiles" },
  { test: /porcelain/, department: "tiles", category: "porcelain-tiles" },
  { test: /ceramic/, department: "tiles", category: "ceramic-tiles" },
  { test: /small-.*-tiles|small-tiles/, department: "tiles", category: "small-floor-tiles" },
  { test: /floor-tiles|floor-and-wall/, department: "tiles", category: "floor-tiles" },
  { test: /wall-tiles/, department: "tiles", category: "luxury-wall-tiles" },
  { test: /vinyl-flooring|vinyl/, department: "flooring", category: "vinyl-flooring" },
  { test: /accessories-and-tools|tile-adhesive|grout|spacer|trim|tiling-tools|sealing-and-cleaning|silicone/, department: "accessories", category: "accessories" },
];

/** Pure colour/size/collection/sale facets — real cross-listed tags, but
 *  not enough on their own to pick a department/category bucket (no
 *  "colour" or "size" department exists, nor should one). Used only to
 *  recognise "this category IS a real WF tag, just not a bucket-worthy
 *  one" vs. something genuinely unexpected. */
function isKnownFacetOnly(slug) {
  return /^(all-tiles|tons-of-tiles-collections|whites-and-woods-collection|new-ranges|sales\/|designer-tiles|budget-|cheap-|coloured-tiles|.*-tiles$|.*-tile-trims$|r1[012]-tiles|large-format-tiles|square-tiles|rectangle-tiles|.*-collection$|dining-room-tiles|bedroom-tiles|hearth-tiles|brands\/|brands$)/.test(
    slug,
  );
}

function bucketFor(categories) {
  for (const rule of KEYWORD_BUCKETS) {
    if (categories.some((c) => rule.test.test(c))) return { department: rule.department, category: rule.category };
  }
  return null;
}

/** Last resort when categories[] is empty (the ~77 orphaned products the
 *  crawl found real detail pages for but no category page linked) or
 *  every category slug is a pure facet the keyword buckets didn't catch —
 *  same role as Al Murad's guessFromName. */
function guessFromName(name) {
  const n = String(name || "").toLowerCase();
  if (/bathroom|shower|wetroom/.test(n)) return { department: "tiles", category: "bathroom-tiles" };
  if (/kitchen|splashback/.test(n)) return { department: "tiles", category: "kitchen-tiles" };
  if (/\bbrick\b|\bmetro\b/.test(n)) return { department: "tiles", category: "brick-tiles" };
  if (/mosaic/.test(n)) return { department: "tiles", category: "mosaic-tiles" };
  if (/slat|panel|cladding/.test(n)) return { department: "wall-panels", category: "claddings" };
  if (/porcelain/.test(n)) return { department: "tiles", category: "porcelain-tiles" };
  if (/floor/.test(n)) return { department: "tiles", category: "floor-tiles" };
  if (/wall/.test(n)) return { department: "tiles", category: "luxury-wall-tiles" };
  return { department: "tiles", category: "floor-tiles" }; // final fallback: this brand is ~99% tiles
}

async function main() {
  if (!fs.existsSync(PDP_FILE)) {
    throw new Error("no capture at " + PDP_FILE + " — run capture-wallsandfloors.cjs first");
  }

  const { db: primary } = await connectMongo();

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
      console.log("created brand " + BRAND_NAME + " (" + brand._id + ", secondary cluster, isActive=" + ACTIVATE + ")");
    }
  } else {
    console.log("brand already exists: " + BRAND_NAME + " (" + brand._id + ")");
  }

  const secConn = await mongoose
    .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
    .asPromise();
  const db = secConn.db;
  console.log("products go to: SECONDARY cluster");

  const productsCol = db.collection("products");

  const countBefore = DRY_RUN ? 0 : await productsCol.countDocuments();

  const primaryProducts = primary.collection("products");
  const existing = new Set();
  for (const col of [primaryProducts, productsCol]) {
    for await (const row of col.find({ sourceUrl: /wallsandfloors\.co\.uk/i }).project({ sourceUrl: 1 })) {
      existing.add(row.sourceUrl);
    }
  }
  console.log("already in Mongo (either cluster): " + existing.size + " Walls and Floors products");

  const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter((l) => l.trim());
  console.log("capture holds " + lines.length + " records");

  let created = 0, skippedExisting = 0, skippedError = 0, noCategoryBucket = 0, guessedFromName = 0;
  const catCount = new Map();
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
    if (rec.error || !rec.name) {
      skippedError++;
      continue;
    }
    processed++;

    if (existing.has(rec.url)) {
      skippedExisting++;
      continue;
    }

    let bucket = bucketFor(rec.categories || []);
    if (!bucket) {
      bucket = guessFromName(rec.name);
      guessedFromName++;
    }
    if (!bucket) {
      noCategoryBucket++;
      continue;
    }
    catCount.set(bucket.category, (catCount.get(bucket.category) || 0) + 1);

    const specs = rec.specs || {};
    const perSqm = parseFloat(specs["Tiles Per SQM"]);
    const priceUnit = specs["Sale by"] || "";
    const isPerSqm = /sqm|m2|m²/i.test(priceUnit);
    /*
     * Wall panels (Trepanel etc.) don't carry "Tiles Per SQM" — some give
     * coverage directly via "Pack Coverage" (price IS for the whole pack —
     * e.g. Trepanel Aqua Luxe: £69.86 for a 4-pack covering 2.80 SQM =
     * £24.95/m², confirmed against the live site's own displayed "SQM
     * (QTY)" + "Pack" dual price). "Panel Coverage" is a DIFFERENT thing
     * and must NOT be treated the same way: on every product checked that
     * has ONLY "Panel Coverage" (no "Pack Coverage"), the live price reads
     * "£X.XX / panel" with a plain "QTY" input — a genuine flat per-unit
     * sale, and "Panel Coverage" is purely informational (how much area
     * one panel happens to cover, for the shopper's own arithmetic), not
     * a real "£/m²" basis. Wiring it into sqmPerBox anyway (a first pass
     * did, for all 104 such products) silently turned a flat-price item
     * into a synthetic area calculator that the source site never shows —
     * confirmed as a real bug, not a style choice. Pack Coverage only.
     */
    const packCoverage = parseFloat(specs["Pack Coverage"]);
    const directCoverage = packCoverage > 0 ? packCoverage : null;

    const now = new Date();

    const doc = {
      name: clean(rec.name),
      description:
        Object.entries(specs).map(([k, v]) => `${k}: ${v}`).join("\n") ||
        clean(rec.description) ||
        clean(rec.name),
      shortDescription: clean(rec.description),

      price: typeof rec.price === "number" ? rec.price : 0,
      priceCurrency: rec.priceCurrency || "GBP",
      rrpIncVat: null,
      specialPrice: null,
      unitOfMeasure: isPerSqm ? "m²" : (specs["Sale by"] ? "Each" : ""),

      images: rec.images || [],

      department: bucket.department,
      category: bucket.category,
      categories: [bucket.category],
      subCategory: "",
      subCategories: [],
      sourceCategories: (rec.categories || []).map((name) => ({ name })),

      brand: brand._id,
      brands: [brand._id],
      subBrand: "",

      supplierSku: rec.sku || "",
      productCode: rec.sku || "",
      finish: specs.Finish || "",
      materials: [specs["Material Type"]].filter(Boolean),
      colours: [specs["Product color"]].filter(Boolean),
      colorOptions: [],
      sizeOptions: [],
      variantGroups: [],

      dimensions: specs.Size ? { size: specs.Size } : {},
      thickness: specs.Thickness ? String(specs.Thickness) : "",
      packCoverageM2: null,
      piecesPerPack: null,

      stock: STOCK_DEFAULT,
      isOutOfStock: /outofstock/i.test(rec.availability || ""),
      stockStatus: /outofstock/i.test(rec.availability || "") ? "out_of_stock" : "in_stock",

      attributes: Object.entries(specs).map(([label, value]) => ({ label, value: String(value) })),

      sourceUrl: rec.url,
      sourceHandle: rec.url.split("/").pop(),
      sourceProductId: rec.sku || rec.gtin || "",
      sourceSku: rec.sku || "",
      canonicalUrl: rec.url,

      /*
       * Same alias wiring as Al Murad — the PDP's own coverage calculator
       * reads `pickSpec(specs, "...")` from this bag, not the typed top-
       * level fields. price is per-sqm or per-discrete-unit depending on
       * "Sale by". When it's per-sqm, sqmPerBox is left unset (there's no
       * box to divide by — pricePerSqmFrom falls back to the raw price
       * either way) but `unit`/`priceUnit` is normalised to the literal
       * string "per m²" regardless of WF's own wording ("Per SQM" does
       * NOT contain the substring "m2"/"m²", so page.tsx's own
       * `priceIsPerSqm` detection regex — `/per\s*m2|per\s*m²/i` — would
       * silently read it as false otherwise). Numerically inconsequential
       * today since no sqmPerBox coexists with a per-sqm price in this
       * brand's data, but leaving the flag wrong would be a landmine if
       * that ever changes — fixed at the source instead.
       */
      specs: Object.assign({}, specs, {
        source: SOURCE_TAG,
        importedAt: now.toISOString(),
        sku: rec.sku || "",
        productCode: rec.sku || "",
        size: specs.Size || "",
        unit: isPerSqm ? "per m²" : priceUnit,
        priceUnit: isPerSqm ? "per m²" : priceUnit,
        tilesPerSqm: perSqm > 0 ? perSqm : undefined,
        sqmPerBox: isPerSqm
          ? undefined
          : directCoverage != null
            ? Number(directCoverage.toFixed(4))
            : perSqm > 0
              ? Number((1 / perSqm).toFixed(4))
              : undefined,
        pricePerM2:
          typeof rec.price === "number" && !isPerSqm
            ? directCoverage != null
              ? Number((rec.price / directCoverage).toFixed(2))
              : perSqm > 0
                ? Number((rec.price * perSqm).toFixed(2))
                : undefined
            : undefined,
      }),

      badges: [],

      createdAt: now,
      updatedAt: now,
      priceSyncedAt: now,
      stockSyncedAt: now,
    };

    if (DRY_RUN) {
      created++;
      if (created <= 8) {
        console.log(
          "  [dry] " + doc.name.slice(0, 60) +
            "\n        GBP " + doc.price + "  " + doc.department + "/" + doc.category +
            "  imgs=" + doc.images.length + " specs=" + Object.keys(specs).length,
        );
      }
      continue;
    }

    ops.push(doc);
    created++;
    if (ops.length >= 200) await flush();
  }
  await flush();

  if (!DRY_RUN) {
    const countAfter = await productsCol.countDocuments();
    const delta = countAfter - countBefore;
    if (delta !== created) {
      throw new Error(
        `SAFETY CHECK FAILED: collection grew by ${delta} documents but this run only ` +
          `inserted ${created}. Stopping rather than reporting a false success.`,
      );
    }
    console.log(`\nsafety check passed: collection count ${countBefore} -> ${countAfter} (+${delta}, matches inserts exactly)`);
  }

  console.log("\n" + (DRY_RUN ? "[dry] " : "") + "created: " + created);
  console.log("skipped (already existed): " + skippedExisting);
  console.log("skipped (scrape error): " + skippedError);
  console.log("skipped (no mappable category): " + noCategoryBucket);
  console.log("category guessed from name (no usable categories[] tag): " + guessedFromName);
  console.log("\nby category:");
  for (const [k, v] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(k).padEnd(20) + v);
  }

  await secConn.close();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

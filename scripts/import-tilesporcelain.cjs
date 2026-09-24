/**
 * Import the Tiles Porcelain capture (.scratch/tilesporcelain/tp-pdp.jsonl)
 * into Mongo. Pattern mirrors import-al-murad.cjs / import-totaltiles.cjs.
 *
 * Strict rules for this brand:
 *
 *  - INSERT ONLY. Every product this script writes is a brand-new document.
 *    It never runs updateOne / updateMany / bulkWrite / deleteOne against an
 *    existing row. A product whose `sourceUrl` is already held in EITHER
 *    cluster is skipped, not overwritten. Re-running is always safe.
 *  - NO NEW CATEGORIES. Every target department/category below was verified
 *    to already exist via `distinct("category",{department})` on the
 *    secondary cluster before writing this table. Nothing here is a new slug.
 *  - Stock is fixed at 500 (STOCK_DEFAULT) for every product.
 *  - Images stay as tilesporcelain.co.uk CDN URLs in `images[]` until
 *    shopify-harvest-brand-images.cjs THEN_REWRITE=1 replaces them with
 *    Shopify CDN URLs.
 *  - Brand.dataCluster = "secondary" (confirmed via db.stats(): secondary
 *    has 20,118 objects vs primary's 28,036 — secondary has headroom, and
 *    it's also where Total Tiles — the last tile brand — already lives).
 *
 * Price: capture-tilesporcelain already resolved the ex-VAT-vs-inc-VAT and
 * per-tile-vs-per-m2 confusion documented in scripts/PLAYBOOK-brand-scrape
 * -import.md — `priceCurrent` (per-tile, inc-VAT) and `pricePerSqmCurrent`
 * (per-m2, inc-VAT) are both already the verified customer-facing prices,
 * no further conversion needed here.
 *
 * Spec key aliases (CRITICAL — without these the frontend coverage
 * calculator silently shows zero/undefined; see src/app/products/[id]/page.tsx):
 *  - pricePerSqmCurrent      → specs.pricePerM2       (page.tsx ~851)
 *  - sqmPerBox (derived)     → specs.sqmPerBox         (page.tsx ~834, ~874)
 *  - tilesPerSqm (derived)   → specs.tilesPerSqm       (page.tsx ~910)
 *  - sku                     → specs.sku               (page.tsx ~828)
 *  - sku                     → specs.productCode       (page.tsx ~829)
 *  - Colour                  → specs.Colour            (page.tsx ~390, already raw)
 *
 * Category resolution: keyword-first (mirror / towel rail / radiator /
 * thermostat / shower pack / paving / grout / adhesive / sealer / trim /
 * spacer / tool / silicone / brick slip all get identified by TITLE first,
 * since "Bathroom"/"Kitchen" breadcrumb top-nodes describe the ROOM, not the
 * product type — an LED mirror and a floor tile can both sit under
 * "Bathroom"). Falls back to breadcrumb-based room/material/style matching
 * for genuine tile products.
 *
 * Env:
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

const TP_DATA =
  process.env.TP_DATA ||
  path.join(__dirname, "..", ".scratch", "tilesporcelain");
const PDP_FILE = path.join(TP_DATA, "tp-pdp.jsonl");

const BRAND_NAME = "Tiles Porcelain";
const BRAND_SLUG = "tiles-porcelain";
const SOURCE_TAG = "tilesporcelain-scrape";
const STOCK_DEFAULT = 500;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const toFloat = (s) => {
  const n = parseFloat(String(s || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ─── Category resolution ───────────────────────────────────────────────────
//
// All targets below verified live on the SECONDARY cluster via
// `distinct("category",{department})` before writing this table.

function keywordCategory(title) {
  const t = String(title || "").toLowerCase();

  // ── Non-tile bathroom hardware — must be checked BEFORE room-based
  //    breadcrumb matching, since these sit under "Bathroom"/"Kitchen" too ──
  if (/led mirror|backlit mirror|battery.*mirror|mirror\b/.test(t)) {
    return { department: "bathrooms", category: "bathroom-mirrors" };
  }
  if (/heated towel rail|towel rail/.test(t)) {
    return { department: "bathrooms", category: "heating" };
  }
  if (/radiator valve|pair of.*valve/.test(t)) {
    return { department: "bathrooms", category: "heating" };
  }
  if (/\bradiator\b/.test(t)) {
    return { department: "bathrooms", category: "heating" };
  }
  // Order matters: "Thermostatic ... Shower Pack" must resolve as a shower,
  // not a thermostat — check the more specific shower-pack phrasing first.
  if (/thermostatic shower|shower pack|shower set|shower kit/.test(t)) {
    return { department: "bathrooms", category: "showers" };
  }
  if (/thermostat/.test(t)) {
    return { department: "accessories", category: "thermostats" };
  }
  if (/underfloor heating|heating mat|heating cable|heating kit/.test(t)) {
    return { department: "bathrooms", category: "heating" };
  }

  // ── Tile accessories / tools / prep (specific before generic) ──
  if (/glitter.*grout|grout.*glitter/.test(t)) {
    return { department: "tiles", category: "glitter-grout" };
  }
  if (/\bgrout\b/.test(t)) {
    return { department: "tiles", category: "grout" };
  }
  if (/adhesive|bonding agent|priming agent|primer\b/.test(t)) {
    return { department: "tiles", category: "tile-adhesive" };
  }
  if (/seal(er|ant)|cleaner|enhancer|intensifier|stripper|protector/.test(t)) {
    return { department: "tiles", category: "sealing-and-cleaning" };
  }
  if (/\btrim\b/.test(t)) {
    return { department: "tiles", category: "tiletrim" };
  }
  if (/\bspacer/.test(t)) {
    return { department: "tiles", category: "spacers" };
  }
  if (/backer board|backing board|anti.?fracture|hole locator|cutter|drill bit|trowel|scraper|\bfloat\b|\btool\b/.test(t)) {
    if (/backer board|backing board|anti.?fracture/.test(t)) {
      return { department: "tiles", category: "tiling-preparation" };
    }
    return { department: "tiles", category: "tiling-tools" };
  }
  if (/\bsilicone\b/.test(t)) {
    return { department: "tiles", category: "silicone" };
  }
  if (/brick slip/.test(t)) {
    return { department: "tiles", category: "brick-tiles" };
  }
  if (/paving|patio slab|garden slab/.test(t)) {
    return { department: "tiles", category: "paving-slabs" };
  }

  // ── Tile styles/materials that are distinctive enough to key off title ──
  if (/mosaic/.test(t)) return { department: "tiles", category: "mosaic-tiles" };
  if (/quartz/.test(t)) {
    // "white-quartz-tiles" is the only quartz-specific bucket that exists on
    // the secondary cluster; reused for every colour rather than falling
    // through to a generic tile category, since quartz is a distinct
    // material line from the porcelain/ceramic products around it.
    return { department: "tiles", category: "white-quartz-tiles" };
  }
  if (/wet.?room/.test(t)) return { department: "tiles", category: "wet-room-flooring" };
  if (/sandstone|riven|indian stone|calibrated.*(pack|paving)/.test(t)) {
    return { department: "tiles", category: "paving-slabs" };
  }

  return null;
}

function breadcrumbCategory(breadcrumb) {
  const bc = breadcrumb || [];
  const navNodes = bc.slice(0, Math.max(bc.length - 1, 0));
  const names = navNodes.map((n) => (n.name || "").toLowerCase());
  const joined = names.join(" > ");

  // Room-based — the largest, most reliable buckets on this site.
  if (names[0] === "bathroom") return { department: "tiles", category: "bathroom-tiles" };
  if (names[0] === "kitchen") return { department: "tiles", category: "kitchen-tiles" };

  // Generic facet top-nodes (Wall / Floor / Material / Colour / Style) —
  // look for room/type hints further down the chain first.
  if (/wall/.test(joined)) return { department: "tiles", category: "luxury-wall-tiles" };
  if (/floor/.test(joined)) return { department: "tiles", category: "floor-tiles" };
  if (/outdoor|external|garden|patio/.test(joined)) {
    return { department: "tiles", category: "outdoor-tiles" };
  }
  if (/marble effect|stone effect|concrete effect|slate effect|natural stone/.test(joined)) {
    return { department: "tiles", category: "natural-stone-effect-tiles" };
  }
  if (/pattern/.test(joined)) return { department: "tiles", category: "patterned-tiles" };
  if (/mosaic/.test(joined)) return { department: "tiles", category: "mosaic-tiles" };
  if (/brick/.test(joined)) return { department: "tiles", category: "brick-tiles" };
  if (/ceramic/.test(joined)) return { department: "tiles", category: "ceramic-tiles" };
  if (/porcelain/.test(joined)) return { department: "tiles", category: "porcelain-tiles" };
  if (names[0] === "accessories") return { department: "accessories", category: "accessories" };

  return null;
}

/** Last-resort keyword pass over the title, once breadcrumb gives nothing. */
function titleFallback(title) {
  const t = String(title || "").toLowerCase();
  if (/wall tile/.test(t)) return { department: "tiles", category: "luxury-wall-tiles" };
  if (/floor tile/.test(t)) return { department: "tiles", category: "floor-tiles" };
  if (/porcelain|ceramic|tile/.test(t)) return { department: "tiles", category: "floor-tiles" };
  return null;
}

function resolveCategory(breadcrumb, title) {
  return (
    keywordCategory(title) ||
    breadcrumbCategory(breadcrumb) ||
    titleFallback(title) ||
    null
  );
}

// ─── Description builder ───────────────────────────────────────────────────
// PDP splits a plain-text description on "\n" into a lead paragraph +
// bulleted list (ProductDetailTabs.tsx). Marketing overview is the lead;
// specs follow one per line as "Label: value" pairs.
function buildDescription(description, specs) {
  const specLines = Object.entries(specs).map(([k, v]) => `${k}: ${v}`);
  if (specLines.length === 0) return clean(description) || "";
  const lead = clean(description);
  return (lead ? lead + "\n" : "") + specLines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(PDP_FILE)) {
    throw new Error(
      "no capture at " + PDP_FILE + " — run scripts/capture-tilesporcelain.cjs first"
    );
  }

  const { db: primary } = await connectMongo();

  // ── 1. Upsert brand document (always in primary; brand.dataCluster tells
  //       us where products go). ──
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

  // ── 2. Open secondary cluster connection for product writes. ──
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

  // ── 3. Count before write (safety check). ──
  const countBefore = DRY_RUN ? 0 : await productsCol.countDocuments();

  // ── 4. Load all existing TilesPorcelain sourceUrls from BOTH clusters. ──
  const primaryProducts = primary.collection("products");
  const existing = new Set();
  for (const col of [primaryProducts, productsCol]) {
    for await (const row of col
      .find({ sourceUrl: /tilesporcelain\.co\.uk/i })
      .project({ sourceUrl: 1 })) {
      existing.add(row.sourceUrl);
    }
  }
  console.log("already in Mongo (either cluster): " + existing.size + " TilesPorcelain products");

  // ── 5. Process records. ──
  const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter((l) => l.trim());
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

    if (rec.error || (rec.status && rec.status !== 200)) {
      skippedError++;
      continue;
    }
    if (!rec.title) {
      skippedError++;
      continue;
    }
    if (rec.isAggregateHub) {
      // Range-selector page, not an individually sellable SKU — its real
      // variants are separately captured records. Never import hubs.
      skippedError++;
      continue;
    }

    processed++;

    if (existing.has(rec.url)) {
      skippedExisting++;
      continue;
    }

    if (rec.priceCurrent == null) {
      skippedNullPrice++;
      if (DRY_RUN) console.log("  [dry] skip (null price): " + rec.title.slice(0, 70));
      continue;
    }

    const bucket = resolveCategory(rec.breadcrumb, rec.title);
    if (!bucket) {
      noCategoryBucket++;
      unmappedUrls.push(rec.url);
      if (DRY_RUN) {
        console.log(
          "  [dry] NO CATEGORY: " + rec.title.slice(0, 70) +
          " | bc=" + JSON.stringify((rec.breadcrumb || []).map((b) => b.name))
        );
      }
      continue;
    }
    catCount.set(
      bucket.department + "/" + bucket.category,
      (catCount.get(bucket.department + "/" + bucket.category) || 0) + 1
    );

    // ── Price / RRP ──
    const priceCurrent = rec.priceCurrent;
    const pricePerSqmCurrent = rec.pricePerSqmCurrent || null;

    // priceRRPPerSqmRaw's VAT basis was never independently verified during
    // capture (see capture-tilesporcelain.cjs) — never promote an
    // unverified "was" price onto the live price's unit. Leave null rather
    // than guess, per the playbook's explicit rule on this.
    const priceRRP = null;
    const priceRRPPerSqm = null;

    // ── Specs: raw table + calculator aliases ──
    const rawSpecs = rec.specs || {};
    const sku = rec.sku || "";

    // tilesPerSqm: prefer the rare direct spec, else derive from the two
    // verified prices (per-m2 price ÷ per-tile price = tiles needed per m2).
    const tilesPerSqmSpec = toFloat(rawSpecs["Tiles Per M2"]);
    const tilesPerSqmDerived =
      pricePerSqmCurrent && priceCurrent
        ? Number((pricePerSqmCurrent / priceCurrent).toFixed(3))
        : null;
    const tilesPerSqm = tilesPerSqmSpec || tilesPerSqmDerived;

    // sqmPerBox: pieces-per-box (scraped) ÷ pieces-per-m2 = m2 one box covers.
    const boxQtyRaw = toFloat(rawSpecs["Box Quantity"]);
    const sqmPerBox =
      boxQtyRaw && tilesPerSqm ? Number((boxQtyRaw / tilesPerSqm).toFixed(3)) : null;

    const specs = Object.assign({}, rawSpecs, {
      source: SOURCE_TAG,
      importedAt: new Date().toISOString(),
      ...(tilesPerSqm ? { tilesPerSqm } : {}),
      ...(sqmPerBox ? { sqmPerBox, packCoverageM2: sqmPerBox } : {}),
      ...(pricePerSqmCurrent ? { pricePerM2: pricePerSqmCurrent } : {}),
      sku,
      productCode: sku,
    });

    const description = buildDescription(rec.description, rawSpecs);

    const isOutOfStock = !/instock/i.test(String(rec.stockStatus || "").replace(/[^a-z]/gi, ""));

    const now = new Date();

    const doc = {
      name: clean(rec.title),
      description,
      shortDescription: "",

      price: priceCurrent,
      priceCurrency: "GBP",
      rrpIncVat: priceRRP,
      specialPrice: null,

      unitOfMeasure: pricePerSqmCurrent ? "m²" : "Each",

      images: rec.images || [],

      department: bucket.department,
      category: bucket.category,
      categories: [bucket.category],
      subCategory: "",
      subCategories: [],
      sourceCategories: (rec.breadcrumb || [])
        .filter((b, i) => i < (rec.breadcrumb || []).length - 1)
        .map((b) => ({ name: b.name })),

      brand: brand._id,
      brands: [brand._id],
      subBrand: "",

      supplierSku: sku,
      productCode: sku,
      finish: rawSpecs["Finish"] || "",
      materials: [rawSpecs["Material"]].filter(Boolean),
      colours: [rawSpecs["Colour"]].filter(Boolean),
      colorOptions: [],
      sizeOptions: [],
      variantGroups: [],

      dimensions: rawSpecs["Sizes"] ? { size: rawSpecs["Sizes"] } : {},
      thickness: rawSpecs["Thickness"] || "",

      packCoverageM2: sqmPerBox || null,
      piecesPerPack: boxQtyRaw || null,

      stock: STOCK_DEFAULT,
      isOutOfStock,
      stockStatus: isOutOfStock ? "out_of_stock" : "in_stock",

      attributes: Object.entries(rawSpecs).map(([label, value]) => ({
        label,
        value: String(value),
      })),

      sourceUrl: rec.url,
      sourceHandle: rec.url.split("/").pop().replace(/\.html$/, ""),
      sourceProductId: sku,
      sourceSku: sku,
      canonicalUrl: rec.url,

      specs,

      badges: [],

      createdAt: now,
      updatedAt: now,
      priceSyncedAt: now,
      stockSyncedAt: now,
    };

    if (DRY_RUN) {
      created++;
      if (created <= 15) {
        console.log(
          "  [dry] " + doc.name.slice(0, 65) +
          "\n        GBP " + doc.price +
          (pricePerSqmCurrent ? " (£" + pricePerSqmCurrent + "/m²)" : "") +
          " | " + doc.department + "/" + doc.category +
          " | imgs=" + doc.images.length +
          " | specs=" + Object.keys(rawSpecs).length +
          (tilesPerSqm ? " | tiles/m²=" + tilesPerSqm : "")
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
        `inserted ${created}. Something else wrote to this collection concurrently — ` +
        `stopping rather than reporting a false success.`
      );
    }
    console.log(
      `\nsafety check passed: secondary collection ${countBefore} → ${countAfter} (+${delta}, matches inserts exactly)`
    );
  }

  const prefix = DRY_RUN ? "[dry] " : "";
  console.log("\n" + prefix + "created:                   " + created);
  console.log(prefix + "skipped (already existed): " + skippedExisting);
  console.log(prefix + "skipped (null price):      " + skippedNullPrice);
  console.log(prefix + "skipped (scrape error/hub):" + skippedError);
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

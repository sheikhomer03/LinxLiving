/**
 * Import the Capietra capture (scripts/capture-capietra.cjs) into Mongo.
 *
 * Strict rules for this brand (same shape as import-bathroom4less.cjs):
 *
 *  - INSERT ONLY. Every product this script writes is a brand-new document.
 *    No updateOne/updateMany/bulkWrite/deleteOne against `products` anywhere.
 *    A `sourceUrl` already held is skipped, not overwritten. Document-count
 *    safety check (before vs after) throws if the delta doesn't match.
 *  - NO NEW CATEGORIES. Capietra's own Shopify collections are mapped onto
 *    `category` values that already exist in the live `products` collection
 *    today for departments "tiles" and "accessories" (queried live below —
 *    nothing here is invented). Nothing is written to `menus`.
 *  - Per the task: this brand's data goes on MONGODB_URI ONLY
 *    (dataCluster: "primary"). MONGODB_URL2 is never read or written.
 *  - Stock fixed at 500 for every product (STOCK_DEFAULT).
 *  - Images: Capietra's own Shopify CDN URLs go into `images[]` as-is; a
 *    later Shopify sync + harvest pass rewrites them, same as Bathroom4Less.
 *
 * ---- Why one DB product = one (Capietra product, size), not one per
 * Shopify product ----
 *
 * Capietra bundles multiple PHYSICAL SIZES as variants of a single Shopify
 * product (e.g. "Dorset Porcelain White": 120x60, 80x80, 60x30, 59.7x59.7cm
 * all under one product, each with its own price and box coverage). The
 * site's own tile-calculator component (`<product-coverage-quantity>`)
 * re-renders per-size coverage data (m² per box, tiles per box, tiles per
 * m²) only for whichever variant is selected.
 *
 * This database's OWN tile-calculator (src/lib/tileCalculator.ts,
 * ProductProjectCalculator.tsx, read via pickSpec(specs, "sqmPerBox") /
 * "tilesPerBox" / "size" in src/app/products/[id]/page.tsx) reads those
 * fields off the TOP-LEVEL product document, not per-embedded-variant —
 * confirmed against a real live Spectra tile doc (department "tiles",
 * category "600x600-tiles"): each physical size is its OWN product
 * document (e.g. "Elijah Gold" @ 600x600 and a same-range product @
 * 600x1200 are two separate docs), cross-linked via `specs.baseTitle` +
 * `specs.size` so `pickSizeOptions()` (src/lib/moreFromProducts.ts) can
 * show "other sizes available" swatches on the PDP.
 *
 * Setting only the typed schema fields and cramming every size into one
 * doc's `variants[]` would silently leave the calculator using only ONE
 * arbitrary size's coverage for every size — wrong for every size but one.
 * So: every distinct non-sample SIZE within a Capietra product becomes its
 * own DB document (specs.baseTitle = the Capietra product name, ties
 * siblings together); COLOUR variants at the same size stay embedded in
 * that size-document's own `variants[]` (colour doesn't change coverage,
 * and the existing `catalogVariants`/`selectedVariant` picker on the PDP
 * already switches price/sku/image per colour within one doc). Sample
 * variants ("Free Cut Tile Sample" / "Full Tile Sample" / "NxNcm Sample")
 * are not imported as separate products — their price feeds
 * `specs.samplePrice` (pickSpec(specs, "samplePrice") | "Sample Price"),
 * matching the existing paid-sample convention used elsewhere
 * (hasPaidSampleFlow()).
 *
 * Env:
 *   CAPIETRA_DATA=path  capture directory (must match capture-capietra.cjs)
 *   DRY_RUN=1           parse and report, write nothing
 *   LIMIT=n             only the first n captured *source* products
 *   ACTIVATE=1          set the brand live once the import succeeds (default: off)
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

const CAPIETRA_DATA =
  process.env.CAPIETRA_DATA ||
  "/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/capietra";
const PDP_FILE = path.join(CAPIETRA_DATA, "capietra-pdp.jsonl");

const BRAND_NAME = "Ca'Pietra";
const BRAND_SLUG = "capietra";
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 500);

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * bodyHtml -> plain text that keeps real paragraph/list breaks, instead of
 * collapsing every tag to a single space (which turned multi-paragraph
 * descriptions into one run-on line — the same bug found and fixed on the
 * Bathroom4Less import). Block-level boundaries become newlines BEFORE
 * tags are stripped, then entities are decoded.
 */
function htmlToLines(html) {
  if (!html) return "";
  let s = String(html);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|li|div|h[1-6])>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return s.trim();
}
const slugify = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/*
 * `category` values that already exist in the live `products` collection
 * for departments "tiles" and "accessories" on MONGODB_URI (verified with
 * `distinct("category", { department })` before writing this file):
 *   tiles: 300x600-tiles, 600x1200-tiles, 600x600-tiles, bathrooms, ceramic,
 *          encaustic-cement, floor-and-wall, gloss, high-gloss, matt,
 *          matt-carving, outdoor-tiles, signature-collection, terrazzo,
 *          zellige-and-bejmat
 *   accessories: accessories, adhesive-grout-silicone, adhesives-levellers,
 *          installation-materials, installation-systems, ... (tools/fixings)
 */
const TILE_CATEGORY_VALUES = new Set([
  "300x600-tiles",
  "600x1200-tiles",
  "600x600-tiles",
  "ceramic",
  "encaustic-cement",
  "floor-and-wall",
  "gloss",
  "high-gloss",
  "matt",
  "matt-carving",
  "outdoor-tiles",
  "signature-collection",
  "terrazzo",
  "zellige-and-bejmat",
]);
const ACCESSORY_CATEGORY_VALUES = new Set([
  "accessories",
  "adhesive-grout-silicone",
  "adhesives-levellers",
  "installation-materials",
  "installation-systems",
]);

/** Junk / non-taxonomy collections (curations, bestsellers, sale, etc.). */
function isJunkTitle(title) {
  const t = clean(title);
  return (
    /^(Best ?sellers?|New (In|Arrivals?)|Sale|Offers?|Clearance)\b/i.test(t) ||
    /^A Curation for/i.test(t) ||
    /^All (Materials|Products?)$/i.test(t) ||
    /Bestsellers?$/i.test(t) ||
    /^(Trade|Shop by|Featured|Collections?)$/i.test(t)
  );
}

/**
 * Classify one Capietra collection title onto {category, subCategory,
 * department} — or null when it's junk / carries no taxonomy signal.
 * Order matters: adhesive/grout (accessories) checked first so it never
 * falls into a tile bucket; specific tile styles (zellige, terrazzo,
 * outdoor, signature) before the generic material/room ones.
 */
function classifyCollectionTitle(title) {
  if (isJunkTitle(title)) return null;
  const t = clean(title).toLowerCase();
  if (!t) return null;

  if (/adhesive|grout|silicone/.test(t)) {
    return { department: "accessories", category: "adhesive-grout-silicone", subCategory: guessSubCategory(title) };
  }
  if (/ancillar|trim|profile|spacer|tool|underlay|leveller|primer/.test(t)) {
    return { department: "accessories", category: "accessories", subCategory: guessSubCategory(title) };
  }
  if (/zellige|bejmat/.test(t)) {
    return { department: "tiles", category: "zellige-and-bejmat", subCategory: guessSubCategory(title) };
  }
  if (/terrazzo/.test(t)) {
    return { department: "tiles", category: "terrazzo", subCategory: guessSubCategory(title) };
  }
  if (/outdoor|exterior|flagstone/.test(t)) {
    return { department: "tiles", category: "outdoor-tiles", subCategory: guessSubCategory(title) };
  }
  if (/signature collection/.test(t)) {
    return { department: "tiles", category: "signature-collection", subCategory: guessSubCategory(title) };
  }
  if (/ceramic/.test(t)) {
    return { department: "tiles", category: "ceramic", subCategory: guessSubCategory(title) };
  }
  // Porcelain, natural stone, mosaic, wall/floor tiles by room or colour —
  // Capietra's real per-product category vocabulary is richer than this
  // DB's narrow tile taxonomy; everything tile-shaped that isn't one of the
  // specific buckets above lands on the DB's own generic tile catch-all.
  if (/tile|porcelain|stone|mosaic|slab|cladding|marble|limestone|travertine/.test(t)) {
    return { department: "tiles", category: "floor-and-wall", subCategory: guessSubCategory(title) };
  }
  return null;
}

const PREFIX_STRIP = /^(exterior|interior|bathroom|kitchen|hallway|indoor)\s+/i;
function guessSubCategory(title) {
  let t = clean(title).replace(PREFIX_STRIP, "").trim();
  t = t || clean(title);
  const slug = slugify(t) || "general";
  return slug.length > 60 ? slug.slice(0, 60) : slug;
}

/**
 * A product's mapped {department, category, subCategory}, chosen by vote
 * across every collection it was crawled under (cross-listed many times —
 * one canonical mapping). A size-bucket match (300x600 / 600x600 /
 * 600x1200) on the SIZE ITSELF overrides the collection vote when present,
 * since that's a stronger, unambiguous signal that matches this DB's own
 * size-named categories exactly.
 */
function mapCategory(collectionTitles, sizeCm) {
  const bucket = sizeBucketCategory(sizeCm);
  if (bucket) return { department: "tiles", category: bucket, subCategory: "Ca'Pietra" };

  const hits = [];
  for (const title of collectionTitles) {
    const c = classifyCollectionTitle(title);
    if (c) hits.push({ ...c, title });
  }
  if (!hits.length) {
    // Not a tile (no size bucket matched above) and every one of its own
    // collection tags is a generic marketing bucket ("All Materials",
    // "Bestsellers", "Finishing Touches") with no descriptive category
    // signal at all — genuine cases seen: sealers/oils, tile cleaners.
    // Same convention as elsewhere: never invent a slug, fall into the
    // existing generic "accessories" catch-all rather than drop the
    // product entirely.
    return { department: "accessories", category: "accessories", subCategory: null };
  }

  const freq = new Map();
  for (const h of hits) {
    const key = h.department + "/" + h.category;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  // "Ancillaries" (-> generic accessories/accessories) and "Grout" (->
  // adhesive-grout-silicone) tie 1-1 on a product cross-listed under both,
  // and a plain tie keeps whichever was seen first — so the generic tag
  // silently beat the correct, specific one purely by array order (real
  // case: "Resin-Cement Grout ..." products landing in generic
  // "accessories" instead of the existing "adhesive-grout-silicone"
  // bucket). Only this one, narrowly-evidenced override: a specific
  // accessories/adhesive-grout-silicone hit beats a tied
  // accessories/accessories hit. Nothing else changes tie behaviour —
  // widening this to "any specific beats any generic" was tried and wrongly
  // pulled silicone/sealant products into tiles/outdoor-tiles just because
  // they were cross-listed under a use-case collection like "Exterior Stone
  // & Tiles" (a "for use with" tag, not a description of the product
  // itself).
  let best = null;
  let bestCount = -1;
  for (const h of hits) {
    const key = h.department + "/" + h.category;
    const c = freq.get(key);
    const isPreferredOverride =
      c === bestCount &&
      best &&
      best.department + "/" + best.category === "accessories/accessories" &&
      key === "accessories/adhesive-grout-silicone";
    if (c > bestCount || isPreferredOverride) {
      bestCount = c;
      best = h;
    }
  }
  const candidates = hits.filter((h) => h.department === best.department && h.category === best.category);
  candidates.sort((a, b) => b.title.split(" ").length - a.title.split(" ").length);
  return { department: best.department, category: best.category, subCategory: candidates[0].subCategory };
}

/** {w,h} in cm -> one of this DB's three size-bucket tile categories, or null. */
function sizeBucketCategory(sizeCm) {
  if (!sizeCm) return null;
  const near = (v, target, tol = 4) => Math.abs(v - target) <= tol;
  const [a, b] = [sizeCm.w, sizeCm.h].sort((x, y) => x - y);
  if (near(a, 30, 3) && near(b, 60, 4)) return "300x600-tiles";
  if (near(a, 60, 4) && near(b, 60, 4)) return "600x600-tiles";
  if (near(a, 60, 4) && near(b, 120, 6)) return "600x1200-tiles";
  return null;
}

/** Pull the first "N x M(...cm)" pair out of a messy variant/size string. */
function extractSizeCm(sig) {
  const m = /([\d.]+)\s*[x×]\s*([\d.]+)(?:\s*[x×]\s*[\d.]+)?\s*cm/i.exec(String(sig || ""));
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h, display: `${trimNum(w)}x${trimNum(h)}` };
}
function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

/**
 * specGroups (from capture stage B) -> flat specs bag, prefixed by group
 * label for the raw table, plus unprefixed for pickSpec() lookups — same
 * convention as import-bathroom4less.cjs.
 */
function flattenSpecGroups(specGroups) {
  const flat = {};
  for (const [group, pairs] of Object.entries(specGroups || {})) {
    for (const [label, value] of Object.entries(pairs)) {
      if (!value) continue;
      flat[label] = value;
      flat[`${group}: ${label}`] = value;
    }
  }
  return flat;
}

const SAMPLE_RE = /\bsample\b/i;

/** Group a product's variants by size signature (samples excluded). */
function groupBySize(variants) {
  const groups = new Map(); // sig -> variants[]
  for (const v of variants) {
    if (v.isSample) continue;
    const sig = v.sizeSignature || v.title;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(v);
  }
  return groups;
}

/** The best available "Full Tile Sample" price across a product's variants. */
function samplePriceOf(variants) {
  const fullSamples = variants.filter((v) => v.isSample && /full tile sample/i.test(v.title) && typeof v.price === "number");
  if (!fullSamples.length) return null;
  return Math.min(...fullSamples.map((v) => v.price));
}

async function main() {
  if (!fs.existsSync(PDP_FILE)) {
    throw new Error("no capture at " + PDP_FILE + " — run capture-capietra.cjs first");
  }

  const { db } = await connectMongo(); // MONGODB_URI only
  const productsCol = db.collection("products");

  let brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) {
    if (DRY_RUN) {
      console.log("[dry] would create brand " + BRAND_NAME + " (dataCluster: primary)");
      brand = { _id: new mongoose.Types.ObjectId(), dataCluster: "primary" };
    } else {
      const res = await db.collection("brands").insertOne({
        name: BRAND_NAME,
        slug: BRAND_SLUG,
        dataCluster: "primary",
        isActive: ACTIVATE,
        order: 0,
        subBrands: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      brand = { _id: res.insertedId, dataCluster: "primary" };
      console.log("created brand " + BRAND_NAME + " (" + brand._id + ", primary cluster, isActive=" + ACTIVATE + ")");
    }
  } else {
    console.log("brand already exists: " + BRAND_NAME + " (" + brand._id + ")");
  }
  console.log("products go to: PRIMARY cluster (MONGODB_URI) only");

  const countBefore = DRY_RUN ? 0 : await productsCol.countDocuments();

  const existing = new Set();
  for await (const row of productsCol.find({ sourceUrl: /capietra\.com/i }).project({ sourceUrl: 1 })) {
    existing.add(row.sourceUrl);
  }
  console.log("already in Mongo (MONGODB_URI): " + existing.size + " Capietra product-docs");

  const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter((l) => l.trim());
  console.log("capture holds " + lines.length + " source-product records");

  let sourceProcessed = 0,
    created = 0,
    skippedExisting = 0,
    skippedError = 0,
    noCategoryBucket = 0,
    variantCountTotal = 0,
    maxVariants = 0,
    minVariants = Infinity,
    multiVariantDocs = 0,
    withImages = 0,
    imageCountTotal = 0,
    zeroSpecDocs = 0;
  const catCount = new Map();
  const unmappedTitles = new Set();
  const rrpRatios = [];
  let ops = [];

  const flush = async () => {
    if (!ops.length) return;
    const batch = ops;
    ops = [];
    if (!DRY_RUN) await productsCol.insertMany(batch, { ordered: false });
  };

  const seenSourceUrl = new Set();

  for (const line of lines) {
    if (sourceProcessed >= LIMIT) break;
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
    sourceProcessed++;

    for (const title of rec.collectionTitles || []) {
      if (!classifyCollectionTitle(title)) unmappedTitles.add(title);
    }

    const sizeGroups = groupBySize(rec.variants || []);
    const samplePrice = samplePriceOf(rec.variants || []);
    const specsBase = flattenSpecGroups(rec.specGroups);

    for (const [sig, groupVariants] of sizeGroups) {
      const sizeCm = extractSizeCm(sig);
      const mapped = mapCategory(rec.collectionTitles || [], sizeCm);
      if (!mapped) {
        noCategoryBucket++;
        continue;
      }
      const allowed =
        mapped.department === "tiles" ? TILE_CATEGORY_VALUES : ACCESSORY_CATEGORY_VALUES;
      if (!allowed.has(mapped.category)) {
        noCategoryBucket++;
        continue;
      }

      // One doc per (product, size). A single-size product's doc name stays
      // exactly the source product name; a multi-size product's doc name
      // gets the size appended so the two docs aren't literal name-dupes
      // (baseTitle below still ties them together for pickSizeOptions()).
      const multiSize = sizeGroups.size > 1;
      const sizeDisplay = sizeCm ? sizeCm.display : null;
      const docName = multiSize && sizeDisplay ? `${clean(rec.name)} ${sizeDisplay}` : clean(rec.name);
      const sourceUrl = multiSize ? `${rec.sourceUrl}?variant=${groupVariants[0].id}` : rec.sourceUrl;

      if (existing.has(sourceUrl) || seenSourceUrl.has(sourceUrl)) {
        skippedExisting++;
        continue;
      }
      seenSourceUrl.add(sourceUrl);

      catCount.set(mapped.department + "/" + mapped.category, (catCount.get(mapped.department + "/" + mapped.category) || 0) + 1);

      const cov = groupVariants.find((v) => v.coverage)?.coverage || null;

      // Coverage unit: data-m-per-pack is m² per pack/box (ex tag on the
      // page's own tile calculator), data-pack-quantity is tiles per pack,
      // data-tiles-per-m is tiles per m² — all rendered server-side by the
      // SAME component that quotes "£X/m² ex. VAT" next to it, so the box
      // price and per-m² figure are already internally consistent (checked
      // against a live sample: £100.94/box ÷ 0.2366 m²/box = £426.64/m²,
      // matching the page's own displayed £426.63/m² to the penny).
      const mPerPack = cov?.mPerPack ? Number(cov.mPerPack) : null;
      const packQuantity = cov?.packQuantity ? Number(cov.packQuantity) : null;
      const tilesPerM = cov?.tilesPerM ? Number(cov.tilesPerM) : null;

      const repVariant =
        groupVariants.find((v) => typeof v.price === "number" && v.price > 0) || groupVariants[0];
      const priceExVat = typeof repVariant.price === "number" ? repVariant.price : 0;

      // RRP: only from a real Shopify compare_at_price on the SAME variant
      // (same unit/currency as price already — both come from the same
      // variant row) — never fabricated, never kept if <= the live price.
      let rrpExVat =
        typeof repVariant.compareAtPrice === "number" && repVariant.compareAtPrice > priceExVat
          ? repVariant.compareAtPrice
          : null;
      if (rrpExVat != null) {
        rrpRatios.push(priceExVat / rrpExVat);
      }

      const images = rec.images || [];
      imageCountTotal += images.length;
      if (images.length) withImages++;

      const specsFlat = Object.assign({}, specsBase);
      const specCount = Object.keys(specsBase).length;
      if (specCount === 0) zeroSpecDocs++;

      const colours = [...new Set(groupVariants.map((v) => v.option1).filter(Boolean))];
      const variantsOut = groupVariants.map((v) => ({
        title: v.title,
        sku: v.sku,
        price: v.price,
        // Same guard as the doc-level rrpExVat above: Capietra's own source
        // data carries nonsensical compare_at_price values on some variants
        // (e.g. a genuine live case: price £10.88, compare_at_price £0.30) —
        // never store a "was" price that isn't actually higher than price.
        compareAtPrice:
          typeof v.compareAtPrice === "number" && v.compareAtPrice > v.price
            ? v.compareAtPrice
            : null,
        available: v.available,
        colour: v.option1 || null,
      }));

      variantCountTotal += variantsOut.length;
      if (variantsOut.length > maxVariants) maxVariants = variantsOut.length;
      if (variantsOut.length < minVariants) minVariants = variantsOut.length;
      if (variantsOut.length > 1) multiVariantDocs++;

      const now = new Date();
      const doc = {
        name: docName,
        description: rec.bodyHtml ? htmlToLines(rec.bodyHtml) : clean(docName),
        shortDescription: "",

        price: priceExVat,
        priceCurrency: "GBP",
        vatRate: 20,
        rrpIncVat: rrpExVat != null ? round2(rrpExVat * 1.2) : null,

        images,

        department: mapped.department,
        category: mapped.category,
        categories: [mapped.category],
        subCategory: mapped.subCategory,
        subCategories: [mapped.subCategory],
        sourceCategories: (rec.collectionTitles || []).map((name) => ({ name })),

        brand: brand._id,
        brands: [brand._id],
        subBrand: rec.vendor || "",

        rangeName: clean(rec.name),

        supplierSku: repVariant.sku || "",
        productCode: repVariant.sku || "",
        manufacturerSku: repVariant.sku || "",
        finish: specsFlat.Finish || "",
        materials: [specsFlat.Material].filter(Boolean),
        colours,
        sizeOptions: [],
        variantGroups: (rec.options || []).map((o) => o.name),
        variants: variantsOut,

        unitOfMeasure: "Box",

        stock: STOCK_DEFAULT,
        isOutOfStock: !groupVariants.some((v) => v.available),
        stockStatus: groupVariants.some((v) => v.available) ? "in_stock" : "out_of_stock",

        attributes: Object.entries(specsFlat)
          .filter(([k]) => !k.includes(":"))
          .map(([label, value]) => ({ label, value: String(value) })),

        sourceUrl,
        sourceHandle: rec.handle,
        sourceProductId: rec.id,
        sourceSku: repVariant.sku || "",
        canonicalUrl: sourceUrl,

        // pickSpec()-readable alias bag — see src/app/products/[id]/page.tsx
        // and src/lib/tileCalculator.ts. This IS a tile-calculator brand
        // (unlike Bathroom4Less): sqmPerBox/tilesPerBox/tilesPerSqm/size
        // below are exactly what ProductProjectCalculator reads through
        // pickSpec(), and baseTitle is what pickSizeOptions() (
        // src/lib/moreFromProducts.ts) uses to cross-link this size back to
        // its sibling sizes from the same Capietra range, matching the
        // existing Spectra convention verified live (one doc per size,
        // baseTitle/size tying them together).
        specs: Object.assign({}, specsFlat, {
          source: "capietra-scrape",
          importedAt: now.toISOString(),
          sku: repVariant.sku || "",
          productCode: repVariant.sku || "",
          unit: "Box",
          priceUnit: "per box",
          vendor: rec.vendor || "",
          compareAtPrice: rrpExVat || undefined,
          baseTitle: clean(rec.name),
          size: sizeDisplay || undefined,
          sqmPerBox: mPerPack ? `${mPerPack} SQM` : undefined,
          packCoverageM2: mPerPack || undefined,
          tilesPerBox: packQuantity || undefined,
          tilesPerSqm: tilesPerM || undefined,
          wastagePercent: cov?.wastagePercent ? Number(cov.wastagePercent) : undefined,
          samplePrice: samplePrice != null ? samplePrice : undefined,
          schemaCategory: rec.schemaCategory || undefined,
        }),

        createdAt: now,
        updatedAt: now,
        priceSyncedAt: now,
        stockSyncedAt: now,
      };

      if (DRY_RUN) {
        created++;
        if (created <= 10) {
          console.log(
            "  [dry] " +
              doc.name.slice(0, 55) +
              "\n        GBP " +
              doc.price +
              (rrpExVat ? " (RRP ex " + rrpExVat + ")" : "") +
              "  " +
              doc.department +
              "/" +
              doc.category +
              "  imgs=" +
              images.length +
              " specs=" +
              specCount +
              " variants=" +
              variantsOut.length +
              " sqmPerBox=" +
              (mPerPack || "?") +
              " tilesPerBox=" +
              (packQuantity || "?"),
          );
        }
        continue;
      }

      ops.push(doc);
      created++;
      if (ops.length >= 200) await flush();
    }
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

  console.log("\nsource products processed: " + sourceProcessed);
  console.log((DRY_RUN ? "[dry] " : "") + "DB docs created (one per product×size): " + created);
  console.log("skipped (already existed): " + skippedExisting);
  console.log("skipped (scrape error): " + skippedError);
  console.log("skipped (no mappable category): " + noCategoryBucket);
  console.log("\nvariant stats per doc: min=" + (minVariants === Infinity ? 0 : minVariants) + " max=" + maxVariants + " avg=" + (created ? (variantCountTotal / created).toFixed(2) : 0) + " docs-with->1-variant=" + multiVariantDocs);
  console.log("images: avg/doc=" + (created ? (imageCountTotal / created).toFixed(2) : 0) + " docs-with-images=" + withImages + "/" + created);
  console.log("docs with zero parsed specs: " + zeroSpecDocs + "/" + created);
  if (rrpRatios.length) {
    const avg = rrpRatios.reduce((a, b) => a + b, 0) / rrpRatios.length;
    console.log("price/RRP ratio: n=" + rrpRatios.length + " avg=" + avg.toFixed(3) + " min=" + Math.min(...rrpRatios).toFixed(3) + " max=" + Math.max(...rrpRatios).toFixed(3));
  }
  console.log("\nby department/category:");
  for (const [k, v] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(k).padEnd(30) + v);
  }
  if (unmappedTitles.size) {
    console.log(`\n${unmappedTitles.size} collection titles with no classification (fine if the product had another, mapped collection):`);
    for (const n of [...unmappedTitles].sort()) console.log("  " + n);
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * One-time correction pass over the 3,000 Bathroom4Less products already
 * in the `products` collection (inserted 2026-09-22 12:46-12:49 UTC by a
 * process outside this session). This is NOT insert-only — targeted
 * updateOne against category-related fields (and, narrowly, missing
 * specs/rawSpecsText/compareAtPrice alias) is explicitly authorized for
 * this one cleanup pass, plus deletion of exactly 3 named orphan _ids.
 *
 * Nothing else is touched: no other field is written unless step 1's live
 * re-verification independently finds it wrong (and even then, price
 * mismatches are only REPORTED, never silently overwritten). No other
 * brand, collection, or script is touched.
 *
 * Env:
 *   DRY_RUN=1       report only, write nothing
 *   CONCURRENCY=n   parallel live fetches (default 5)
 *   LIMIT=n         only process first n of the 3000 (smoke test)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { ObjectId } = require("mongodb");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 5, 8));
const LIMIT = Number(process.env.LIMIT) || Infinity;

const ORIGIN = "https://www.bathroom4less.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const OUT_DIR = "/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/bathroom4less";
const LOG_FILE = path.join(OUT_DIR, "fix-live-log.jsonl"); // per-product checkpoint/log
const DONE_FILE = path.join(OUT_DIR, "fix-live-done.json"); // _ids already processed (resumable)
const CAPTURE_FILE = path.join(OUT_DIR, "b4l-pdp.jsonl");

const ORPHAN_IDS = [
  "6ab285df44ededa68b5b3e37",
  "6ab285de44ededa68b5b3e33",
  "6ab285dd44ededa68b5b3e30",
];

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const slugify = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/* ------------------------------------------------------------------ *
 * CATEGORY_MAP — verbatim copy of the corrected classification logic
 * from scripts/import-bathroom4less.cjs (source of truth per task).
 * ------------------------------------------------------------------ */
const CATEGORY_VALUES = new Set([
  "bathrooms",
  "bathroom-taps",
  "sanitaryware",
  "shower",
  "bathroom-furniture",
  "basins",
  "bathtub",
  "kitchen-taps",
  "shower-trays",
]);

function isJunkTitle(title) {
  const t = clean(title);
  return (
    /^\d{1,2} Off Group$/i.test(t) ||
    /^(Best Selling|Top Selling|Newest|New)( Products?)?( \d+)?$/i.test(t) ||
    /^All( Products?)?( \d+)?$/i.test(t) ||
    /^Other$/i.test(t) ||
    /^Sale( Event| Collections?)?$/i.test(t) ||
    /^Promo Clearance( \d+)?$/i.test(t) ||
    /^(Good Friday|Valentine|Earth Day|New|Bundle|Kiosk|Wholesale) Collections?( \d+)?$/i.test(t) ||
    /^Nubud[ _]?\d*$/i.test(t) ||
    /\bTest$/i.test(t) ||
    /^(Bathroom4less|Home4less|Hudson Reed|Ibathuk|Nuie|Veebath|Ibath|Old London)( \d+)?$/i.test(t) ||
    /^Standard (Products|Trade Catalog)( \d+)?$/i.test(t) ||
    /^Fresh Finds/i.test(t) ||
    /^Asset Pack.*Example Products$/i.test(t)
  );
}

const PREFIX_STRIP = /^(wholesale|ibath|ibathuk|nuie|veebath|home4less|modern|traditional|best|top|standard|other|shop)\s+/i;

function guessSubCategory(title) {
  let t = clean(title).replace(PREFIX_STRIP, "").trim();
  t = t || clean(title);
  const slug = slugify(t) || "general";
  return slug.length > 60 ? slug.slice(0, 60) : slug;
}

function classifyCollectionTitle(title) {
  if (isJunkTitle(title)) return null;
  const t = clean(title).toLowerCase();
  if (!t) return null;

  if (/kitchen/.test(t) && /tap/.test(t)) {
    return { category: "kitchen-taps", subCategory: guessSubCategory(title) };
  }
  if (/\btap\b|taps\b|mixer\b.*tap|tap.*mixer|\bspout\b/.test(t) && !/sink/.test(t)) {
    return { category: "bathroom-taps", subCategory: guessSubCategory(title) };
  }
  if (/shower.*tray|tray.*shower|showertrays/.test(t)) {
    return { category: "shower-trays", subCategory: guessSubCategory(title) };
  }
  if (/shower/.test(t)) {
    return { category: "shower", subCategory: guessSubCategory(title) };
  }
  if (/toilet|bidet|\bwc\b|cistern|urinal|flush plate/.test(t)) {
    return { category: "sanitaryware", subCategory: guessSubCategory(title) };
  }
  if (/basin|\bsink/.test(t)) {
    return { category: "basins", subCategory: guessSubCategory(title) };
  }
  if (/\bbaths?\b|bathtub|slipper bath|steel bath/.test(t)) {
    return { category: "bathtub", subCategory: guessSubCategory(title) };
  }
  if (/enclosure|shower|wet ?room|pivot|quadrant|bi[- ]?fold door|sliding door|hinged door|corner entry|side panel|riser rail|slider kit/.test(t)) {
    return { category: "shower", subCategory: guessSubCategory(title) };
  }
  if (/furniture|vanity|cabinet|cloakroom|storage (unit|cabinet)|wc unit|mirror/.test(t)) {
    return { category: "bathroom-furniture", subCategory: guessSubCategory(title) };
  }
  if (/radiator|towel rail|underfloor heating|\bheating\b|heated towel|pipe shrouds?/.test(t)) {
    return { category: "bathrooms", subCategory: "heating" };
  }
  if (/suite/.test(t)) {
    return { category: "bathrooms", subCategory: "suites" };
  }
  if (
    /accessor|robe hook|toothbrush|toilet roll|shelves|waste bin|curtain rail|grab rail|tumbler|soap dish|towel (bar|ring)/.test(
      t,
    )
  ) {
    return { category: "bathrooms", subCategory: "accessories" };
  }
  return null;
}

function mapCategory(collectionTitles) {
  const hits = [];
  for (const title of collectionTitles) {
    const c = classifyCollectionTitle(title);
    if (c) hits.push({ ...c, title });
  }
  if (!hits.length) return null;

  const specific = hits.filter((h) => h.category !== "bathrooms");
  const pool = specific.length ? specific : hits;

  const freq = new Map();
  for (const h of pool) freq.set(h.category, (freq.get(h.category) || 0) + 1);
  let bestCategory = null;
  let bestCount = -1;
  for (const h of pool) {
    const c = freq.get(h.category);
    if (c > bestCount) {
      bestCount = c;
      bestCategory = h.category;
    }
  }
  const candidates = pool.filter((h) => h.category === bestCategory);
  candidates.sort((a, b) => b.title.split(" ").length - a.title.split(" ").length);
  return { category: bestCategory, subCategory: candidates[0].subCategory };
}

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

/* ------------------------------------------------------------------ *
 * live fetch helpers
 * ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(800 * (i + 1));
        continue;
      }
      if (!res.ok) return { httpStatus: res.status };
      try {
        return await res.json();
      } catch {
        return null;
      }
    } catch {
      await sleep(800 * (i + 1));
    }
  }
  return null;
}

async function pool(items, limit, worker) {
  let i = 0;
  let active = 0;
  return new Promise((resolve) => {
    if (items.length === 0) return resolve();
    const next = () => {
      if (i >= items.length && active === 0) return resolve();
      while (active < limit && i < items.length) {
        const item = items[i++];
        active++;
        Promise.resolve(worker(item))
          .catch((e) => console.error("worker error:", e && e.message))
          .finally(() => {
            active--;
            next();
          });
      }
    };
    next();
  });
}

function handleFromDoc(doc) {
  if (doc.sourceHandle) return doc.sourceHandle;
  const m = /\/products\/([^/?#]+)/.exec(doc.sourceUrl || "");
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("loading capture (specs/rawSpecsText source) from " + CAPTURE_FILE);
  const captureByUrl = new Map();
  if (fs.existsSync(CAPTURE_FILE)) {
    const lines = fs.readFileSync(CAPTURE_FILE, "utf8").split("\n").filter((l) => l.trim());
    for (const line of lines) {
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (r.error || !r.sourceUrl) continue;
      captureByUrl.set(r.sourceUrl, r);
    }
  }
  console.log("capture index: " + captureByUrl.size + " products");

  const { db } = await connectMongo();
  const col = db.collection("products");

  const countBefore = await col.countDocuments();
  console.log("products collection count BEFORE: " + countBefore);

  const docs = await col
    .find({ sourceUrl: /bathroom4less\.co\.uk/i })
    .project({
      _id: 1,
      name: 1,
      sourceUrl: 1,
      sourceHandle: 1,
      sourceProductId: 1,
      price: 1,
      rrpIncVat: 1,
      subBrand: 1,
      category: 1,
      categories: 1,
      subCategory: 1,
      subCategories: 1,
      sourceCategories: 1,
      specs: 1,
      variants: 1,
      supplierSku: 1,
    })
    .toArray();
  console.log("DB docs to process: " + docs.length + (docs.length !== 3000 ? "  ** WARNING: expected 3000 **" : ""));

  const done = new Set(fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, "utf8")) : []);
  const todo = docs.filter((d) => !done.has(String(d._id))).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`resuming: ${done.size} already processed, ${todo.length} to go`);

  const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

  let processed = 0;
  let categoryFixed = 0;
  let specsAdded = 0;
  let priceMismatches = [];
  let titleMismatches = [];
  let skuMismatches = [];
  let liveFetchFailed = 0;
  let categoryExamples = [];

  await pool(todo, CONCURRENCY, async (doc) => {
    const idStr = String(doc._id);
    const handle = handleFromDoc(doc);
    const logEntry = { _id: idStr, sourceUrl: doc.sourceUrl, handle };

    // ---- 1. live re-verify ----
    let live = null;
    if (handle) {
      const json = await getJson(`${ORIGIN}/products/${handle}.json`);
      if (json && json.product) live = json.product;
    }
    if (!live) {
      liveFetchFailed++;
      logEntry.liveFetch = "failed";
    } else {
      const liveVariant = (live.variants || [])[0] || {};
      const livePrice = liveVariant.price != null ? Number(liveVariant.price) : null;
      const liveTitle = clean(live.title);
      const liveSku = liveVariant.sku || "";

      if (liveTitle && clean(doc.name) !== liveTitle) {
        titleMismatches.push({ _id: idStr, db: doc.name, live: liveTitle });
        logEntry.titleMismatch = { db: doc.name, live: liveTitle };
      }
      if (livePrice != null && typeof doc.price === "number" && Math.abs(livePrice - doc.price) > 0.005) {
        priceMismatches.push({ _id: idStr, name: doc.name, dbPrice: doc.price, livePrice });
        logEntry.priceMismatch = { dbPrice: doc.price, livePrice };
      }
      if (liveSku && doc.supplierSku && liveSku !== doc.supplierSku) {
        skuMismatches.push({ _id: idStr, name: doc.name, dbSku: doc.supplierSku, liveSku });
        logEntry.skuMismatch = { dbSku: doc.supplierSku, liveSku };
      }
    }

    // ---- 2. category correction ----
    const titles = (doc.sourceCategories || []).map((c) => c.name);
    const mapped = mapCategory(titles);
    const setFields = {};
    if (mapped && CATEGORY_VALUES.has(mapped.category)) {
      const catChanged = mapped.category !== doc.category;
      const subChanged = mapped.subCategory !== doc.subCategory;
      if (catChanged || subChanged) {
        setFields.category = mapped.category;
        setFields.categories = [mapped.category];
        setFields.subCategory = mapped.subCategory;
        setFields.subCategories = [mapped.subCategory];
        logEntry.categoryFix = {
          old: { category: doc.category, subCategory: doc.subCategory },
          new: { category: mapped.category, subCategory: mapped.subCategory },
        };
        categoryFixed++;
        if (categoryExamples.length < 15) {
          categoryExamples.push({
            name: doc.name,
            old: `${doc.category}/${doc.subCategory}`,
            new: `${mapped.category}/${mapped.subCategory}`,
          });
        }
      }
    } else {
      logEntry.categoryMapFailed = true;
    }

    // ---- 3. specs addition (narrow: only fill genuinely missing keys) ----
    const cap = captureByUrl.get(doc.sourceUrl);
    if (cap) {
      const flat = flattenSpecGroups(cap.specGroups);
      const existingSpecs = doc.specs || {};
      const specSet = {};
      let addedAny = false;
      for (const [k, v] of Object.entries(flat)) {
        if (existingSpecs[k] === undefined || existingSpecs[k] === null || existingSpecs[k] === "") {
          specSet[`specs.${k}`] = v;
          addedAny = true;
        }
      }
      if (!existingSpecs.rawSpecsText && cap.rawSpecsText) {
        specSet["specs.rawSpecsText"] = cap.rawSpecsText;
        addedAny = true;
      }
      // compareAtPrice alias: only set if genuinely missing/wrong AND a
      // valid rrpIncVat exists on the doc already (never invent one here).
      if (
        typeof doc.rrpIncVat === "number" &&
        doc.rrpIncVat > (doc.price || 0) &&
        existingSpecs.compareAtPrice !== doc.rrpIncVat
      ) {
        specSet["specs.compareAtPrice"] = doc.rrpIncVat;
        addedAny = true;
      }
      if (addedAny) {
        Object.assign(setFields, specSet);
        specsAdded++;
        logEntry.specsAdded = Object.keys(specSet);
      }
    } else {
      logEntry.noCaptureMatch = true;
    }

    // ---- write ----
    if (Object.keys(setFields).length && !DRY_RUN) {
      await col.updateOne({ _id: doc._id }, { $set: setFields });
    }

    logStream.write(JSON.stringify(logEntry) + "\n");
    done.add(idStr);
    processed++;
    if (processed % 100 === 0) {
      console.log(
        `  progress ${processed}/${todo.length}  catFixed=${categoryFixed} specsAdded=${specsAdded} priceMismatch=${priceMismatches.length} liveFailed=${liveFetchFailed}`,
      );
      fs.writeFileSync(DONE_FILE, JSON.stringify([...done]));
    }
  });

  fs.writeFileSync(DONE_FILE, JSON.stringify([...done]));
  logStream.end();

  // ---- 4. delete the 3 confirmed orphans ----
  let orphanDeleteResult = null;
  if (!DRY_RUN) {
    // re-confirm untraceability right before deleting
    let safe = true;
    for (const id of ORPHAN_IDS) {
      const d = await col.findOne({ _id: new ObjectId(id) });
      if (!d) continue; // already gone / not found is fine
      if (d.sourceUrl) {
        console.error(`REFUSING to delete ${id}: has a non-empty sourceUrl (${d.sourceUrl}) — not an orphan.`);
        safe = false;
      }
    }
    if (safe) {
      orphanDeleteResult = await col.deleteMany({ _id: { $in: ORPHAN_IDS.map((id) => new ObjectId(id)) } });
      console.log("orphans deleted:", orphanDeleteResult.deletedCount);
    } else {
      console.log("orphan deletion SKIPPED due to safety check failure above.");
    }
  }

  const countAfter = await col.countDocuments();
  const delta = countAfter - countBefore;

  console.log("\n================ SUMMARY ================");
  console.log("DRY_RUN:", DRY_RUN);
  console.log("processed this run:", processed, "/ total todo:", todo.length);
  console.log("total done (cumulative, resumable):", done.size, "/ 3000 expected");
  console.log("category corrections:", categoryFixed);
  console.log("docs with specs additions:", specsAdded);
  console.log("live fetch failed:", liveFetchFailed);
  console.log("title mismatches:", titleMismatches.length);
  console.log("price mismatches (NOT overwritten, reported only):", priceMismatches.length);
  console.log("sku mismatches:", skuMismatches.length);
  console.log("\nexample category corrections:");
  for (const e of categoryExamples) console.log(`  ${e.name.slice(0, 50)}: ${e.old} -> ${e.new}`);
  if (priceMismatches.length) {
    console.log("\nprice mismatches (sample up to 20):");
    for (const p of priceMismatches.slice(0, 20)) {
      console.log(`  ${p.name.slice(0, 50)}: db=${p.dbPrice} live=${p.livePrice} (_id=${p._id})`);
    }
  }
  console.log("\nproducts collection count:", countBefore, "->", countAfter, " delta:", delta);
  console.log("===========================================\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "fix-live-summary.json"),
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        processedThisRun: processed,
        totalDone: done.size,
        categoryFixed,
        specsAdded,
        liveFetchFailed,
        titleMismatches,
        priceMismatches,
        skuMismatches,
        countBefore,
        countAfter,
        delta,
        orphanDeleteResult: orphanDeleteResult ? orphanDeleteResult.deletedCount : null,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

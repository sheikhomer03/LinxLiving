/**
 * Colour/size sibling-linking pass for Walls and Floors — run after
 * capture-wallsandfloors.cjs + import-wallsandfloors.cjs. Finds each
 * product's real colour siblings (other separately-listed products of
 * the same range) and writes `specs.variantSiblings` so the PDP can show
 * a real colour-swatch picker (src/lib/variantSiblings.ts +
 * ProductVariantColorSwatches.tsx).
 *
 * How this works, and why (three earlier approaches were tried and
 * failed on real data before landing here — worth keeping so the same
 * mistakes aren't repeated on a future brand):
 *
 *  1. The in-page swatch UI has no href at all (pure client-side state) —
 *     can't be scraped statically, but its `alt="Color: X"` text IS
 *     reliably present on every product that has real colour siblings,
 *     and turned out to be fully authoritative: every product in a true
 *     colour family shows the IDENTICAL swatch array (same items, any
 *     order), confirmed against real data — 5 Matt Trepanel panels all
 *     show the same 5-entry array, 3 Gloss ones share a different
 *     7-entry array, a standalone product has its own singleton array.
 *  2. A "shop the collection" carousel further down the page sometimes
 *     has real hrefs to the true siblings — but not always; on some
 *     products it's an unrelated accessories cross-sell instead, with no
 *     structural way to tell the two apart. Ruled out.
 *  3. Reconstructing siblings from the PRODUCT NAME (stripping the colour
 *     word, matching what's left) doesn't work: WF's naming embeds a
 *     per-colour "style" word ("Almond", "Eton", "Sage") that isn't part
 *     of the `Product color` spec value, so stripping just the colour
 *     never produces a matching key across true siblings.
 *  4. A looser name-overlap heuristic (≥85% shared words after stripping
 *     colour) got two things wrong on real data: it cross-linked "Matt"
 *     and "Gloss" finish variants together (their names overlap heavily
 *     minus colour, but the live site treats them as separate,
 *     non-cross-linked ranges), and it separately MISSED a genuine
 *     same-finish sibling whose descriptive wording differed enough
 *     (0.778 overlap, just under the cutoff).
 *  5. Landed here: group by the EXACT swatch array (the site's own
 *     authoritative grouping, no guessing) — but a SHORT/generic array
 *     ("White", "Black") isn't distinctive enough alone; several
 *     completely unrelated ranges happened to offer exactly that 2-colour
 *     set. Adding the product name's first word as a second, cheap
 *     required match closes that gap without weakening the longer,
 *     already-distinctive arrays.
 *
 * SIZE siblings are deliberately NOT grouped the same way: a size SET
 * ("100x100mm, 200x200mm") is generic, shared across many unrelated
 * ranges as a standard offering — grouping by it alone wrongly linked
 * Monoedge to Deluxe Gold Leaf and Pixel Hexagon Mosaic (confirmed real
 * bug). Where a range varies by BOTH colour and size under one swatch
 * (Monoedge again), the colour grouping alone already captures every
 * size combination correctly, since colour siblings share the identical
 * swatch array regardless of which size they're on. A colour-only
 * range's size variants fall back to the generic pickSizeOptions
 * mechanism (moreFromProducts.ts) — narrower coverage at scale, but that
 * beats wrongly linking unrelated products.
 *
 * PACK/PANEL COVERAGE: while re-auditing this brand's calculator, found
 * that wall panels (Trepanel etc.) never carry "Tiles Per SQM" — they
 * give coverage directly via "Pack Coverage" (price is for the whole
 * pack) or "Panel Coverage" (price is for one panel), a completely
 * separate field the original import missed. Fixed directly in
 * import-wallsandfloors.cjs (Pack Coverage takes priority when both
 * exist — confirmed against a product's own live £/m² figure).
 *
 * Env:
 *   FRESH=1     ignore any existing checkpoint, start over
 *   LIMIT=n     only the first n products (debugging)
 *   DRY_RUN=1   report the grouping, write nothing to Mongo
 */
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", ".scratch", "wallsandfloors");
const CHECKPOINT_FILE = path.join(DATA_DIR, "wf-siblings-raw.jsonl");
const FRESH = process.env.FRESH === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const DRY_RUN = process.env.DRY_RUN === "1";

fs.mkdirSync(DATA_DIR, { recursive: true });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function get(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!res.ok) throw new Error("HTTP " + res.status + " on " + url);
    return await res.text();
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 1200 * Math.pow(2, attempt)));
    return get(url, attempt + 1);
  }
}

function parseSwatchColours(html) {
  return [...new Set([...html.matchAll(/alt="Color: ([^"]+)"/g)].map((m) => m[1].trim()))];
}

function familyKey(list) {
  if (!Array.isArray(list) || list.length < 2) return null; // singleton/empty — not a real family
  return [...list].map((s) => String(s).trim().toLowerCase()).sort().join("|");
}

function firstWord(name) {
  return String(name || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
}

/* ---------- stage 1: fetch each live page's swatch colours ---------- */

async function fetchSwatchData() {
  const capFile = path.join(DATA_DIR, "wf-pdp.jsonl");
  const allRecs = fs.readFileSync(capFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => !r.error);
  console.log("catalogue size:", allRecs.length);

  const already = new Map();
  if (!FRESH && fs.existsSync(CHECKPOINT_FILE)) {
    for (const line of fs.readFileSync(CHECKPOINT_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        already.set(r.url, r);
      } catch {}
    }
  }
  console.log("already captured:", already.size);

  const out = fs.createWriteStream(CHECKPOINT_FILE, { flags: FRESH ? "w" : "a" });
  let done = 0, errors = 0;
  const started = Date.now();

  for (const rec of allRecs) {
    if (done >= LIMIT) break;
    if (already.has(rec.url)) continue;
    done += 1;
    try {
      const html = await get(rec.url);
      out.write(JSON.stringify({ url: rec.url, swatchColours: parseSwatchColours(html) }) + "\n");
    } catch (e) {
      errors += 1;
      out.write(JSON.stringify({ url: rec.url, error: String(e.message || e) }) + "\n");
    }
    if (done % 100 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((allRecs.length - already.size - done) / Math.max(rate, 0.001) / 60);
      console.log("  " + done + " checked, " + errors + " errors, ~" + left + "m left");
    }
  }
  out.end();
  console.log("done fetching. checked " + done + " this run, " + errors + " errors");
}

/* ---------- stage 2: group + link ---------- */

async function linkSiblings() {
  const mongoose = require("mongoose");
  for (const f of [".env.local", ".env"]) {
    const p = path.join(__dirname, "..", f);
    if (fs.existsSync(p)) require("dotenv").config({ path: p });
  }
  const { connectMongo } = require("./mongo-connect.cjs");

  const rawRecs = fs.readFileSync(CHECKPOINT_FILE, "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => !r.error);
  const pdpRecs = fs.readFileSync(path.join(DATA_DIR, "wf-pdp.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => !r.error);
  const nameByUrl = new Map(pdpRecs.map((r) => [r.url, r.name]));

  const colourFamilies = new Map();
  for (const r of rawRecs) {
    const ck = familyKey(r.swatchColours);
    if (!ck) continue;
    const key = firstWord(nameByUrl.get(r.url)) + "||" + ck;
    if (!colourFamilies.has(key)) colourFamilies.set(key, []);
    colourFamilies.get(key).push(r.url);
  }
  console.log("distinct colour families (2+ members):", colourFamilies.size);

  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ name: "Walls and Floors" });
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  const col = conn.db.collection("products");

  const docs = await col.find({ brand: brand._id }).project({ sourceUrl: 1, name: 1, price: 1, images: 1, specs: 1 }).toArray();
  const byUrl = new Map(docs.map((d) => [d.sourceUrl, d]));

  function summarize(doc) {
    return {
      id: String(doc._id),
      name: doc.name,
      colour: doc.specs?.["Product color"] || "",
      size: doc.specs?.Size || "",
      price: doc.price,
      image: (doc.images || [])[0] || "",
    };
  }

  const ops = [];
  let withSiblings = 0, totalEdges = 0;
  for (const r of rawRecs) {
    const doc = byUrl.get(r.url);
    if (!doc) continue;
    const ck = familyKey(r.swatchColours);
    if (!ck) continue;
    const key = firstWord(nameByUrl.get(r.url)) + "||" + ck;
    const siblingUrls = (colourFamilies.get(key) || []).filter((u) => u !== r.url);
    if (!siblingUrls.length) continue;
    const variantSiblings = siblingUrls.map((su) => byUrl.get(su)).filter(Boolean).map(summarize);
    if (!variantSiblings.length) continue;
    withSiblings++;
    totalEdges += variantSiblings.length;
    ops.push({
      updateOne: {
        filter: { _id: doc._id, brand: brand._id },
        update: { $set: { "specs.variantSiblings": variantSiblings } },
      },
    });
  }

  console.log("products that will get variantSiblings:", withSiblings, " total edges:", totalEdges);
  if (!DRY_RUN && ops.length) {
    for (let i = 0; i < ops.length; i += 300) {
      await col.bulkWrite(ops.slice(i, i + 300), { ordered: false });
      console.log("  wrote " + Math.min(i + 300, ops.length) + "/" + ops.length);
    }
    console.log("done.");
  } else if (DRY_RUN) {
    console.log("[dry run — nothing written]");
  }
  await conn.close();
}

async function main() {
  await fetchSwatchData();
  await linkSiblings();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

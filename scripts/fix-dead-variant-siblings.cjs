/**
 * Repoint or drop specs.variantSiblings entries that name a deleted product.
 *
 * Walls and Floors and Tiles Porcelain were imported one product per colour,
 * with specs.variantSiblings linking the colourways (ProductVariantColorSwatches
 * navigates to /products/<sibling.id>). Colourways were later merged into one
 * product with variants and the per-colour documents deleted, but the sibling
 * snapshots kept the old ids — so the colour swatches open a "not found" page.
 *
 * For each sibling whose id no longer exists (DB2), find where that colourway
 * lives now by its variant (or product) name:
 *   - a variant of this very product → drop the entry (the variant dropdown
 *     already offers it; keeping it duplicated the colour as a dead swatch)
 *   - another existing product       → point the entry at that product
 *   - nowhere                         → drop the entry
 * Two entries landing on the same product keep the first (one swatch per
 * product). Only specs.variantSiblings changes; each document is backed up.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-dead-variant-siblings.cjs           # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-dead-variant-siblings.cjs --write
 */
const path = require("path");
const fs = require("fs");
const util = require("util");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}

const { EJSON } = mongoose.mongo.BSON;
const WRITE = process.argv.includes("--write");
const DIR = path.join(__dirname, "..", "image-audit", "variant-siblings");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const say = (s = "") => process.stdout.write(`${s}\n`);
const norm = (s) => String(s || "").toLowerCase().replace(/[®™]/g, "").replace(/\s+/g, " ").trim();

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const conn = await connectMongo(process.env.MONGODB_URL2);
  const col = conn.db.collection("products");

  const all = await col.find({}).project({ name: 1, category: 1, variants: 1 }).toArray();
  const byId = new Map(all.map((d) => [String(d._id), d]));
  const byVariantName = new Map();
  for (const d of all) for (const v of d.variants || []) if (v.name && !byVariantName.has(norm(v.name))) byVariantName.set(norm(v.name), String(d._id));
  const byName = new Map(all.map((d) => [norm(d.name), String(d._id)]));

  const docs = await col.find({ "specs.variantSiblings.0": { $exists: true } }).toArray();
  const t = { products: 0, dropped: 0, repointed: 0, droppedDuplicate: 0, written: 0, verifiedOk: 0, problems: 0 };
  const backupFile = path.join(DIR, `backup-${STAMP}.ejson.jsonl`);

  for (const d of docs) {
    const self = String(d._id);
    const sibs = d.specs.variantSiblings;
    if (!sibs.some((s) => !byId.has(String(s.id)))) continue;
    t.products++;

    const seen = new Set([self]);
    const next = [];
    for (const s of sibs) {
      let id = String(s.id);
      if (!byId.has(id)) {
        const home = byVariantName.get(norm(s.name)) || byName.get(norm(s.name));
        if (!home || home === self) {
          t.dropped++;
          continue;
        }
        id = home;
        t.repointed++;
      }
      if (seen.has(id)) {
        t.droppedDuplicate++;
        continue;
      }
      seen.add(id);
      next.push(id === String(s.id) ? s : { ...s, id });
    }
    if (!WRITE) continue;

    fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
    const res = await col.updateOne(
      { _id: d._id, "specs.variantSiblings": sibs },
      { $set: { "specs.variantSiblings": next } },
    );
    if (res.modifiedCount !== 1) {
      t.problems++;
      say(`  not written (changed meanwhile): ${self}`);
      continue;
    }
    t.written++;
    // Verify: only specs.variantSiblings changed, and every remaining sibling exists and is on the site.
    const a = await col.findOne({ _id: d._id });
    const strip = (x) => {
      const c = JSON.parse(EJSON.stringify(x, { relaxed: false }));
      if (c.specs) delete c.specs.variantSiblings;
      return c;
    };
    const sameRest = util.isDeepStrictEqual(strip(d), strip(a));
    const allLive = (a.specs.variantSiblings || []).every((s) => byId.has(String(s.id)) && String(byId.get(String(s.id)).category || "").trim());
    if (sameRest && allLive) t.verifiedOk++;
    else {
      t.problems++;
      say(`  PROBLEM ${self} sameRest=${sameRest} allLive=${allLive}`);
    }
  }

  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${JSON.stringify(t)}`);
  if (WRITE) say(`backup: ${backupFile}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

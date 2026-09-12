/**
 * Collapse byte-identical duplicates in the UFH _files folder.
 *
 * download-shopify-brand-files.cjs names each document after the file on
 * Shopify's CDN. fix-ufhs-pdfs.cjs named the same documents after the link
 * *text* on the page — `PW_Underwood_Installation.pdf` was already there as
 * `prowarm--low-profile-overlay-panels-installation.pdf`. No filename rule
 * connects those two, so the second pass saved 276 documents a second time:
 * 463MB of exact duplicates.
 *
 * Content is the only reliable key, so group by MD5 and keep one copy of each.
 * Which one matters: products in Mongo carry the path of the older name, so a
 * referenced file is always the survivor and the fresh copy is what goes. Only
 * where nothing references either does the shorter name win.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/dedupe-ufhs-files.cjs
 *   DRY=1  list what would be removed, delete nothing
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.env.DRY === "1";
const DIR = path.join(__dirname, "..", "public", "the-under-floor-heating", "downloads", "_files");
const PREFIX = "/the-under-floor-heating/downloads/_files/";
const ROLLBACK = path.join(
  __dirname,
  `rollback-ufhs-dedupe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);

/** Every _files path any product points at, so a live file is never removed. */
async function referencedNames(db) {
  const brand = await db.collection("brands").findOne({ slug: "the-under-floor-heating" });
  const products = await db
    .collection("products")
    .find({ brand: brand._id }, { projection: { downloads: 1, manuals: 1, brochures: 1, installationMaintenanceGuides: 1 } })
    .toArray();

  const names = new Set();
  const walk = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      if (value.startsWith(PREFIX)) names.add(decodeURIComponent(value.slice(PREFIX.length)));
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    if (typeof value === "object") for (const v of Object.values(value)) walk(v);
  };
  for (const p of products) walk(p);
  return names;
}

async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const referenced = await referencedNames(mongoose.connection.db);
  console.log(`${referenced.size} file name(s) referenced by products\n`);

  const files = fs.readdirSync(DIR);
  const byHash = new Map();
  for (const f of files) {
    const full = path.join(DIR, f);
    if (!fs.statSync(full).isFile()) continue;
    const h = crypto.createHash("md5").update(fs.readFileSync(full)).digest("hex");
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(f);
  }

  const removals = [];
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    // A referenced name must survive; otherwise keep the shortest, which is
    // the tidier of the two conventions.
    const sorted = [...group].sort((a, b) => {
      const ra = referenced.has(a) ? 0 : 1;
      const rb = referenced.has(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.length - b.length || a.localeCompare(b);
    });
    const keep = sorted[0];
    for (const drop of sorted.slice(1)) {
      if (referenced.has(drop)) {
        console.log(`  keeping both — ${drop} is also referenced (dup of ${keep})`);
        continue;
      }
      removals.push({ drop, keep, bytes: fs.statSync(path.join(DIR, drop)).size });
    }
  }

  const bytes = removals.reduce((s, r) => s + r.bytes, 0);
  console.log(`${files.length} file(s) on disk`);
  console.log(`${removals.length} redundant cop${removals.length === 1 ? "y" : "ies"} — ${(bytes / 1024 / 1024).toFixed(0)}MB\n`);
  for (const r of removals.slice(0, 15)) console.log(`  rm ${r.drop}\n     (same bytes as ${r.keep})`);
  if (removals.length > 15) console.log(`  …and ${removals.length - 15} more`);

  if (DRY) {
    console.log("\nDRY — nothing deleted.");
    await mongoose.disconnect();
    return;
  }

  fs.writeFileSync(ROLLBACK, `${JSON.stringify(removals, null, 2)}\n`);
  for (const r of removals) fs.unlinkSync(path.join(DIR, r.drop));

  console.log(`\nRemoved ${removals.length}, freed ${(bytes / 1024 / 1024).toFixed(0)}MB`);
  console.log(`${fs.readdirSync(DIR).length} file(s) remain`);
  console.log(`Rollback list written to scripts/${path.basename(ROLLBACK)}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

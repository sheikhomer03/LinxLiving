/**
 * Collapse Otto Tiles' installation guides to one copy each.
 *
 * The guides were mirrored per product, which wrote 287 files — but Otto issue
 * one guide per tile *type*, not per colour, so those 287 files are four PDFs
 * repeated. On disk that is 743 MB of which 10 MB is content, and committing it
 * would put three quarters of a gigabyte into the repository permanently.
 *
 * Each distinct guide is written once under `public/otto-tiles/guides/`, every
 * product is repointed at the shared copy, and the per-product duplicates are
 * removed.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/dedupe-otto-guides.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/dedupe-otto-guides.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/dedupe-otto-guides.cjs --rollback <file.json>
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const PUBLIC = path.join(__dirname, "..", "public");
const DOWNLOADS = path.join(PUBLIC, "otto-tiles", "downloads");
const GUIDES = path.join(PUBLIC, "otto-tiles", "guides");

/**
 * The guide names the tile type, not the product.
 *
 * Every copy is called after the first product it was mirrored for
 * ("guide-amalfi-yellow-zellige-…"), which reads oddly once one file serves
 * ninety products. Otto publish one guide per material, so the material is the
 * name; anything unrecognised keeps its filename rather than being guessed at.
 */
const GUIDE_TYPES = [
  [/zellige|bejmat/i, "zellige-and-bejmat-tiles-guide.pdf"],
  [/cement/i, "cement-tiles-guide.pdf"],
  [/marble/i, "marble-tiles-guide.pdf"],
  [/ceramic/i, "ceramic-tiles-guide.pdf"],
];

function canonicalName(file) {
  const base = path.basename(file);
  for (const [pattern, name] of GUIDE_TYPES) if (pattern.test(base)) return name;
  return base;
}

const walk = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : full.endsWith(".pdf") ? [full] : [];
      })
    : [];

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let n = 0;
  for (const p of data.products || []) {
    await db
      .collection("products")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { installationMaintenanceGuides: p.guides } },
      );
    n += 1;
  }
  console.log(`restored guide URLs on ${n} product(s)`);
  console.log("the per-product PDF copies were deleted; re-run mirror-pdfs-to-local to fetch them again");
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  if (ROLLBACK) {
    await runRollback(db, ROLLBACK);
    await mongoose.disconnect();
    return;
  }

  const files = walk(DOWNLOADS);
  const byHash = new Map();
  for (const file of files) {
    const hash = crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
    if (!byHash.has(hash)) byHash.set(hash, { name: canonicalName(file), files: [] });
    byHash.get(hash).files.push(file);
  }

  const onDisk = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  const unique = [...byHash.values()].reduce((n, g) => n + fs.statSync(g.files[0]).size, 0);

  console.log(`guide files on disk : ${files.length}  (${(onDisk / 1048576).toFixed(0)} MB)`);
  console.log(`distinct guides     : ${byHash.size}  (${(unique / 1048576).toFixed(1)} MB)\n`);
  for (const g of byHash.values()) {
    console.log(`  ${String(g.files.length).padStart(3)} copies -> /otto-tiles/guides/${g.name}`);
  }

  // Map every current per-product URL to the shared one it should point at.
  const rewrite = new Map();
  for (const g of byHash.values()) {
    for (const file of g.files) {
      const rel = "/" + path.relative(PUBLIC, file).split(path.sep).join("/");
      rewrite.set(rel, `/otto-tiles/guides/${g.name}`);
    }
  }

  const products = await db
    .collection("products")
    .find({ "installationMaintenanceGuides.url": { $regex: "^/otto-tiles/downloads/" } })
    .project({ name: 1, installationMaintenanceGuides: 1 })
    .toArray();

  console.log(`\nproducts to repoint  : ${products.length}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackFile = path.join(process.cwd(), `rollback-otto-guides-${stamp}.json`);
  fs.writeFileSync(
    rollbackFile,
    JSON.stringify(
      {
        products: products.map((p) => ({
          _id: String(p._id),
          guides: p.installationMaintenanceGuides,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`rollback written up front: ${rollbackFile}`);

  fs.mkdirSync(GUIDES, { recursive: true });
  for (const g of byHash.values()) {
    fs.copyFileSync(g.files[0], path.join(GUIDES, g.name));
  }

  let changed = 0;
  for (const p of products) {
    const guides = (p.installationMaintenanceGuides || []).map((entry) => {
      const next = rewrite.get(String(entry?.url || ""));
      return next ? { ...entry, url: next } : entry;
    });
    await db
      .collection("products")
      .updateOne({ _id: p._id }, { $set: { installationMaintenanceGuides: guides } });
    changed += 1;
  }

  fs.rmSync(DOWNLOADS, { recursive: true, force: true });

  const after = walk(GUIDES).reduce((n, f) => n + fs.statSync(f).size, 0);
  console.log(
    `\nrepointed ${changed} product(s)` +
      `\nkept ${byHash.size} guide(s) — ${(after / 1048576).toFixed(1)} MB` +
      `\nremoved the per-product copies (${(onDisk / 1048576).toFixed(0)} MB freed)`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

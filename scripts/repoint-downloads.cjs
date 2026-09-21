/**
 * Point product downloads at our own copies of the files.
 *
 * The enrichment ran while `download-product-files.cjs` was still fetching,
 * so it wrote the supplier URL for every document. Now that the manifest is
 * complete, each download whose file we hold is re-pointed at
 * /product-files/<site>/, and the rest are left on the supplier so nothing
 * links to a file that is not there.
 *
 * Deliberately narrow: it touches `downloads[].url` and nothing else. Re-
 * running the enrichment would also rewrite `variants`, discarding the
 * Shopify image pairing the mirror job writes onto them.
 *
 * Env:
 *   SITE=name   manifest to read (default "drench")
 *   BRAND=slug  brand to update (default: same as SITE)
 *   DRY_RUN=1   report only
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const SITE = process.env.SITE || "drench";
const BRAND_SLUG = process.env.BRAND || SITE;
const DRY_RUN = process.env.DRY_RUN === "1";
const DATA =
  process.env.GIBE_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

async function main() {
  const manifestPath = path.join(DATA, SITE + "-files-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("no manifest at " + manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  console.log("manifest : " + Object.keys(manifest).length + " files");

  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);

  let db = primary;
  let secConn = null;
  if (brand.dataCluster === "secondary") {
    secConn = await mongoose
      .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 })
      .asPromise();
    db = secConn.db;
  }
  const P = db.collection("products");

  const filter = { brand: brand._id, "downloads.0": { $exists: true } };
  console.log("products : " + (await P.countDocuments(filter)) + " with downloads");
  console.log("mode     : " + (DRY_RUN ? "DRY RUN" : "LIVE"));
  console.log("");

  let scanned = 0, changed = 0, links = 0, unresolved = 0;
  let ops = [];
  const flush = async () => {
    if (!DRY_RUN && ops.length) await P.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const doc of P.find(filter).project({ downloads: 1 })) {
    scanned += 1;
    let touched = false;
    const next = (doc.downloads || []).map((d) => {
      const source = d.sourceUrl || d.url;
      const local = manifest[source];
      if (!local) { unresolved += 1; return d; }
      if (d.url === local.path) return d;
      touched = true;
      links += 1;
      return { ...d, url: local.path, sourceUrl: source };
    });
    if (!touched) continue;
    changed += 1;
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { downloads: next } } } });
    if (ops.length >= 500) await flush();
  }
  await flush();

  console.log("scanned       : " + scanned);
  console.log("products fixed: " + changed);
  console.log("links repointed: " + links);
  console.log("not downloaded : " + unresolved + "  (left on the supplier URL)");
  if (secConn) await secConn.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Make every Bathdisc option and every folded/merged Bathdisc page findable by
 * the site search: writes specs.searchText (option names, variant SKUs, the
 * original Bathdisc titles of merged or duplicate pages, maker) on Bathdisc
 * products only (specs.source = "bathdisc-scrape", DB2). Touches only that field.
 *
 *   DRY_RUN=1 node scripts/bathdisc-search-text.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const DRY_RUN = process.env.DRY_RUN === "1";
const TAG = "bathdisc-scrape";
const FINAL = path.join(__dirname, "../.scratch/bathdisc/v2/bathdisc-final.json");
const PROGRESS = path.join(__dirname, "../.scratch/bathdisc/v2/progress.log");
const log = (m) => { const line = `[${new Date().toISOString()}] SEARCH ${m}`; console.log(line); fs.appendFileSync(PROGRESS, line + "\n"); };

async function main() {
  // original Bathdisc titles of every page folded into a product, by product key
  const aliasByKey = new Map(JSON.parse(fs.readFileSync(FINAL, "utf8")).map((p) => [p.key, (p.aliases || []).map((a) => a.title)]));
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const col = client.db().collection("products");
  const rows = await col.find({ "specs.source": TAG }, { projection: { name: 1, variants: 1, specs: 1, sourceProductId: 1 } }).toArray();
  const ops = rows.map((p) => {
    const parts = new Set();
    for (const v of p.variants || []) {
      if (v.name) parts.add(v.name.replace(/\s*\/\s*/g, " "));
      if (v.sku) parts.add(String(v.sku));
      for (const val of Object.values(v.options || {})) if (val) parts.add(String(val));
    }
    for (const t of aliasByKey.get(p.sourceProductId) || []) parts.add(t);
    if (p.specs?.Manufacturer) parts.add(String(p.specs.Manufacturer));
    return { updateOne: { filter: { _id: p._id, "specs.source": TAG }, update: { $set: { "specs.searchText": [...parts].join(" | ") } } } };
  });
  log(`${DRY_RUN ? "[dry run] " : ""}${ops.length} Bathdisc products to update (specs.searchText only)`);
  if (!DRY_RUN) {
    let modified = 0;
    for (let i = 0; i < ops.length; i += 500) {
      modified += (await col.bulkWrite(ops.slice(i, i + 500), { ordered: false })).modifiedCount;
      log(`search text saved ${Math.min(i + 500, ops.length)}/${ops.length}`);
    }
    log(`DONE: ${modified} updated`);
  }
  await client.close();
}

main().catch((e) => { log(`ERROR ${e.message}`); process.exit(1); });

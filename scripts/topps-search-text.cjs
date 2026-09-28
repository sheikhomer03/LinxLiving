/**
 * Make every Topps Tiles option findable by the site search.
 *
 * Each Topps product merges many Topps pages (colours / sizes / finishes), so
 * "Hazel Oak 0.3mm SPC Flooring" is an option of "SPC Flooring" and the search
 * — which reads only name / SKU / category / size — never saw it. This writes
 * specs.searchText on Topps products only: every option name, Topps' own name
 * for each option, and every option SKU.
 *
 * Touches only documents tagged specs.source = "topps-scrape", and only the
 * specs.searchText field.
 *
 *   DRY_RUN=1 node scripts/topps-search-text.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const DRY_RUN = process.env.DRY_RUN === "1";
const RAW = path.join(__dirname, "../.scratch/toppstiles/v2/raw-products.jsonl");

// Topps' own product name for every SKU, from the capture
const nameBySku = new Map();
for (const line of fs.readFileSync(RAW, "utf8").split("\n")) {
  if (!line) continue;
  const p = JSON.parse(line);
  if (p.sku && p.name) nameBySku.set(String(p.sku), String(p.name).replace(/\s+/g, " ").trim());
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db().collection("products");
  const rows = await col.find({ "specs.source": "topps-scrape" }, { projection: { name: 1, variants: 1, specs: 1 } }).toArray();
  const ops = [];
  for (const p of rows) {
    const parts = new Set();
    for (const v of p.variants || []) {
      if (v.name) parts.add(v.name.replace(/\s*\/\s*/g, " "));
      if (v.sku) { parts.add(String(v.sku)); if (nameBySku.has(String(v.sku))) parts.add(nameBySku.get(String(v.sku))); }
      for (const val of Object.values(v.options || {})) if (val) parts.add(String(val));
    }
    if (p.specs?.Range) parts.add(String(p.specs.Range));
    const searchText = [...parts].join(" | ");
    ops.push({ updateOne: { filter: { _id: p._id, "specs.source": "topps-scrape" }, update: { $set: { "specs.searchText": searchText } } } });
  }
  const sample = rows.find((r) => r.name === "SPC Flooring");
  if (sample) console.log("example — SPC Flooring:", ops[rows.indexOf(sample)].updateOne.update.$set["specs.searchText"].slice(0, 300), "…");
  console.log(`${DRY_RUN ? "[dry run] " : ""}${ops.length} Topps products to update (specs.searchText only)`);
  if (!DRY_RUN) {
    let modified = 0;
    for (let i = 0; i < ops.length; i += 200) modified += (await col.bulkWrite(ops.slice(i, i + 200), { ordered: false })).modifiedCount;
    console.log(`updated ${modified}`);
  }
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

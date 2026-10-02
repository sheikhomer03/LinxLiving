/**
 * Drops four `products` indexes nothing queries, on both clusters.
 *
 *   tradePrice_1, supplierCategory_1, legacyProductCode_1 — no site query
 *   filters or sorts on these fields.
 *   department_1 — every department query is served by the compound
 *   indexes that start with `department`.
 *
 * Run only AFTER the build without these declarations in Product.ts is
 * deployed: Mongoose autoIndex rebuilds any index the running schema still
 * declares. Indexes hold no data; to undo, recreate with createIndex.
 *
 *   node scripts/drop-unused-product-indexes.cjs           # dry run
 *   node scripts/drop-unused-product-indexes.cjs --apply   # drop
 */
require("dotenv").config({ path: ".env.local", quiet: true });
require("dns").setServers(
  (process.env.MONGODB_DNS_SERVERS || "8.8.8.8").split(","),
);
const { MongoClient } = require("mongodb");

const APPLY = process.argv.includes("--apply");
const DROP = [
  "tradePrice_1",
  "supplierCategory_1",
  "legacyProductCode_1",
  "department_1",
];

async function run(label, uri) {
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db("test").collection("products");
  const [stats] = await col
    .aggregate([{ $collStats: { storageStats: {} } }])
    .toArray();
  const sizes = stats.storageStats.indexSizes;
  const existing = new Set(Object.keys(sizes));

  for (const name of DROP) {
    if (!existing.has(name)) {
      console.log(`${label}: ${name} — not present, skipped`);
      continue;
    }
    const mb = (sizes[name] / 1048576).toFixed(2);
    if (APPLY) {
      await col.dropIndex(name);
      console.log(`${label}: ${name} — dropped (${mb} MB)`);
    } else {
      console.log(`${label}: ${name} — would drop (${mb} MB)`);
    }
  }
  await client.close();
}

(async () => {
  await run("primary", process.env.MONGODB_URI);
  await run("secondary", process.env.MONGODB_URL2);
  if (!APPLY) console.log("\nDry run. Re-run with --apply to drop.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

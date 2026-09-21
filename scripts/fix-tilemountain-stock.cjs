/**
 * Zero the stock on Tile Mountain products the source lists as unavailable.
 *
 * `import-tilemountain` applied DEFAULT_STOCK whenever the capture carried no
 * quantity. That default is for a product the source does not publish a
 * figure for — a gap. An out-of-stock product publishes no figure either, so
 * it took the default too and landed as "out of stock, 1000 units". The
 * importer no longer does this; these are the rows written before the fix.
 *
 * Only touches products already flagged out of stock, so nothing sellable
 * changes. A rollback file records every previous value.
 *
 * Env:
 *   DRY_RUN=1  report only
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
const BRAND_SLUG = process.env.BRAND || "tile-mountain";

async function main() {
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

  const filter = {
    brand: brand._id,
    stockStatus: "out_of_stock",
    stock: { $gt: 0 },
  };

  const total = await P.countDocuments({ brand: brand._id });
  const target = await P.countDocuments(filter);

  console.log(DRY_RUN ? "MODE: DRY RUN" : "MODE: LIVE");
  console.log("brand   : " + brand.name + "  (cluster: " + (secConn ? "secondary" : "primary") + ")");
  console.log("");
  console.log("products                      : " + total);
  console.log("out_of_stock but stock > 0    : " + target + "   <- set to 0");
  console.log("in stock (untouched)          : " +
    await P.countDocuments({ brand: brand._id, stockStatus: "in_stock" }));
  console.log("");

  if (!target) {
    console.log("nothing to do");
    if (secConn) await secConn.close();
    process.exit(0);
  }

  const sample = await P.find(filter).project({ name: 1, stock: 1 }).limit(3).toArray();
  for (const s of sample) {
    console.log("  " + String(s.name).slice(0, 52).padEnd(54) + "stock=" + s.stock + " -> 0");
  }
  console.log("");

  if (DRY_RUN) {
    if (secConn) await secConn.close();
    process.exit(0);
  }

  // Record what is being changed so it can be put back.
  const before = (await P.find(filter).project({ _id: 1, stock: 1 }).toArray()).map(
    (d) => ({ _id: String(d._id), stock: d.stock }),
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(__dirname, "..", "rollback-" + BRAND_SLUG + "-stock-" + stamp + ".json");
  fs.writeFileSync(file, JSON.stringify(before));
  console.log("rollback written: " + path.basename(file) + "  (" + before.length + " products)");

  const r = await P.updateMany(filter, { $set: { stock: 0, isOutOfStock: true } });
  console.log("matched " + r.matchedCount + ", modified " + r.modifiedCount);
  console.log("");
  console.log("after:");
  console.log("  out_of_stock with stock > 0 : " + await P.countDocuments(filter));
  console.log("  in_stock with stock > 0     : " +
    await P.countDocuments({ brand: brand._id, stockStatus: "in_stock", stock: { $gt: 0 } }));

  if (secConn) await secConn.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Give every stockless product in the secondary-cluster brands a stock floor.
 *
 * Applies to products with no usable figure — missing, null or <= 0 — across
 * Drench and Tile Mountain.
 *
 * The flags are set with the number, not left behind it. Checkout gates on
 * the quantity alone (`{ _id, stock: { $gte: qty } }` in api/orders/route.ts)
 * and never reads `isOutOfStock` or `stockStatus`, so a product carrying
 * stock while still flagged out of stock is both sellable and labelled
 * unavailable — the contradiction this repo has already been bitten by.
 *
 * NOTE: for products the supplier publishes as OutOfStock this deliberately
 * overrides the source. A later re-import or an inbound Shopify sync can set
 * them back, since both take availability from the supplier.
 *
 * Env:
 *   STOCK=n    floor to apply (default 500)
 *   BRANDS=a,b brand slugs (default "drench,tile-mountain")
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

const STOCK = Number(process.env.STOCK) || 500;
const SLUGS = (process.env.BRANDS || "drench,tile-mountain").split(",").map((s) => s.trim());
const DRY_RUN = process.env.DRY_RUN === "1";

const NO_STOCK = {
  $or: [{ stock: { $exists: false } }, { stock: null }, { stock: { $lte: 0 } }],
};

async function main() {
  const { db: primary } = await connectMongo();
  const secConn = await mongoose
    .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 })
    .asPromise();

  console.log(DRY_RUN ? "MODE: DRY RUN" : "MODE: LIVE");
  console.log("floor: " + STOCK);
  console.log("");

  const rollback = [];
  let grandTotal = 0;

  for (const slug of SLUGS) {
    const brand = await primary.collection("brands").findOne({ slug });
    if (!brand) { console.log(slug + ": brand not found"); continue; }

    const db = brand.dataCluster === "secondary" ? secConn.db : primary;
    const P = db.collection("products");
    const filter = Object.assign({ brand: brand._id }, NO_STOCK);

    const total = await P.countDocuments({ brand: brand._id });
    const target = await P.countDocuments(filter);
    grandTotal += target;

    console.log(brand.name + "  (" + brand.dataCluster + ")");
    console.log("  products          : " + total);
    console.log("  without stock     : " + target + "   <- set to " + STOCK);

    if (!target) { console.log(""); continue; }

    const rows = await P.find(filter)
      .project({ _id: 1, stock: 1, stockStatus: 1, isOutOfStock: 1 })
      .toArray();
    for (const r of rows) {
      rollback.push({
        cluster: brand.dataCluster,
        _id: String(r._id),
        stock: r.stock === undefined ? null : r.stock,
        stockStatus: r.stockStatus === undefined ? null : r.stockStatus,
        isOutOfStock: r.isOutOfStock === undefined ? null : r.isOutOfStock,
      });
    }

    if (DRY_RUN) {
      const sample = rows.slice(0, 3);
      for (const s of sample) {
        console.log("    " + String(s._id) + "  stock=" + JSON.stringify(s.stock) +
          " status=" + JSON.stringify(s.stockStatus) + " -> " + STOCK + " / in_stock");
      }
      console.log("");
      continue;
    }

    const r = await P.updateMany(filter, {
      $set: {
        stock: STOCK,
        isOutOfStock: false,
        stockStatus: "in_stock",
        stockSyncedAt: new Date(),
      },
    });
    console.log("  modified          : " + r.modifiedCount);
    console.log("  remaining stockless: " + await P.countDocuments(filter));
    console.log("");
  }

  if (!DRY_RUN && rollback.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(__dirname, "..", "rollback-stock-floor-" + stamp + ".json");
    fs.writeFileSync(file, JSON.stringify(rollback));
    console.log("rollback written: " + path.basename(file) + "  (" + rollback.length + " products)");
  }
  console.log("total affected: " + grandTotal);

  await secConn.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

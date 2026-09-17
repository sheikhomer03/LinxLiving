/**
 * Give Drench products the stock figure the schema would have defaulted them to.
 *
 * `import-drench.cjs` inserted through the raw driver, which bypasses Mongoose
 * defaults, and the capture rarely carried a stock number — so the field
 * landed missing or zero on almost the whole brand while every other brand got
 * DEFAULT_STOCK. The storefront reads that as out of stock, even though
 * `stockStatus` says "in_stock".
 *
 * Only touches products the source reported as in stock. The rest keep what
 * they have: a product the supplier listed as unavailable should stay that way.
 *
 * Env:
 *   DRY_RUN=1   report only
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const BRAND_SLUG = "drench";
/** Mirrors DEFAULT_STOCK in src/models/Product.ts. */
const DEFAULT_STOCK = 1000;

async function main() {
  const { db } = await connectMongo();
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);
  const P = db.collection("products");

  // In stock at source, but holding no usable stock figure.
  const filter = {
    brand: brand._id,
    stockStatus: "in_stock",
    $or: [{ stock: { $exists: false } }, { stock: null }, { stock: { $lte: 0 } }],
  };

  const total = await P.countDocuments({ brand: brand._id });
  const target = await P.countDocuments(filter);
  const already = await P.countDocuments({ brand: brand._id, stock: { $gt: 0 } });
  const notInStock = await P.countDocuments({
    brand: brand._id,
    stockStatus: { $ne: "in_stock" },
  });

  console.log(DRY_RUN ? "MODE: DRY RUN" : "MODE: LIVE");
  console.log("");
  console.log("Drench products            : " + total);
  console.log("  already have stock > 0   : " + already);
  console.log("  in_stock but no figure   : " + target + "   <- set to " + DEFAULT_STOCK);
  console.log("  not in stock at source   : " + notInStock + "   <- left alone");
  console.log("");

  if (!target) { console.log("nothing to do"); process.exit(0); }

  if (DRY_RUN) {
    const sample = await P.find(filter).project({ name: 1, stock: 1, stockStatus: 1 })
      .limit(4).toArray();
    console.log("[dry] examples:");
    for (const s of sample) {
      console.log("  " + String(s.name).slice(0, 52).padEnd(54) +
        "stock=" + JSON.stringify(s.stock));
    }
    process.exit(0);
  }

  // Record which products were changed so the edit can be undone.
  const ids = (await P.find(filter).project({ _id: 1, stock: 1 }).toArray()).map(
    (d) => ({ _id: String(d._id), stock: d.stock === undefined ? null : d.stock }),
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(__dirname, "..", "rollback-drench-stock-" + stamp + ".json");
  fs.writeFileSync(file, JSON.stringify(ids));
  console.log("rollback written: " + path.basename(file) + "  (" + ids.length + " products)");

  const r = await P.updateMany(filter, {
    $set: { stock: DEFAULT_STOCK, isOutOfStock: false, stockSyncedAt: new Date() },
  });
  console.log("");
  console.log("matched " + r.matchedCount + ", modified " + r.modifiedCount);

  console.log("");
  console.log("after:");
  console.log("  stock > 0    : " + await P.countDocuments({ brand: brand._id, stock: { $gt: 0 } }));
  console.log("  stock 0/none : " + await P.countDocuments({
    brand: brand._id,
    $or: [{ stock: { $exists: false } }, { stock: null }, { stock: { $lte: 0 } }],
  }));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

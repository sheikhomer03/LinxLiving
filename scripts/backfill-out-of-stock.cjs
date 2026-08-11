/**
 * Ensure every product in the database has positive stock.
 *
 * Finds every product where stock is missing, null, or <= 0 and sets it to a
 * realistic random level between 800 and 1000. Also clears the isOutOfStock
 * flag and normalises stockStatus to "in_stock" on those same rows, since
 * both are otherwise-redundant mirrors of the same stock number everywhere
 * else in this codebase (see src/lib/suppliers/syncEngine.ts,
 * src/app/actions/admin.ts) — leaving them stale would let a product still
 * surface as out of stock via those fields even after this fix.
 *
 * Only stock/isOutOfStock/stockStatus are touched. Price, name, category,
 * description, and every other field are left exactly as they are.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-out-of-stock.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-out-of-stock.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-out-of-stock.cjs --rollback <file>
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const APPLY = process.argv.includes("--apply");
const ROLLBACK_IDX = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX > -1 ? process.argv[ROLLBACK_IDX + 1] : null;

const MIN_STOCK = 800;
const MAX_STOCK = 1000;
const BATCH_SIZE = 500;

function randomStock() {
  return Math.floor(MIN_STOCK + Math.random() * (MAX_STOCK - MIN_STOCK + 1));
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");

  if (ROLLBACK_FILE) {
    const rows = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    let n = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const ops = chunk.map((r) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(r._id) },
          update: {
            $set: {
              stock: r.stock,
              isOutOfStock: r.isOutOfStock,
              stockStatus: r.stockStatus,
            },
          },
        },
      }));
      await Products.bulkWrite(ops);
      n += chunk.length;
    }
    console.log(`Rolled back stock on ${n} products.`);
    await mongoose.disconnect();
    return;
  }

  const filter = {
    $or: [{ stock: { $lte: 0 } }, { stock: null }, { stock: { $exists: false } }],
  };

  const targets = await Products.find(filter)
    .project({ _id: 1, stock: 1, isOutOfStock: 1, stockStatus: 1 })
    .toArray();

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`out-of-stock products found: ${targets.length}`);
  console.log(`new stock range: ${MIN_STOCK}-${MAX_STOCK} (randomised per product)`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  if (targets.length === 0) {
    console.log("Nothing to update.");
    await mongoose.disconnect();
    return;
  }

  const backup = targets.map((p) => ({
    _id: String(p._id),
    stock: typeof p.stock === "number" ? p.stock : null,
    isOutOfStock: typeof p.isOutOfStock === "boolean" ? p.isOutOfStock : null,
    stockStatus: typeof p.stockStatus === "string" ? p.stockStatus : null,
  }));
  const file = path.join(
    process.cwd(),
    `rollback-out-of-stock-backfill-${backup.length}-${Date.now()}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRollback file: ${path.basename(file)}`);

  let updated = 0;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const chunk = targets.slice(i, i + BATCH_SIZE);
    const ops = chunk.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            stock: randomStock(),
            isOutOfStock: false,
            stockStatus: "in_stock",
            updatedAt: new Date(),
          },
        },
      },
    }));
    const res = await Products.bulkWrite(ops);
    updated += res.modifiedCount;
    console.log(`  ${Math.min(i + BATCH_SIZE, targets.length)}/${targets.length}`);
  }

  console.log(`\nProducts updated: ${updated}`);
  console.log(
    `To undo: node --require ./scripts/mongo-dns.cjs scripts/backfill-out-of-stock.cjs --rollback ${path.basename(file)}`,
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Set stock on every priced product.
 *
 * Only 67 of 4,667 priced products were genuinely at zero (42 of them
 * Porcelanosa), but this sets the level across the board as requested so no
 * priced product can show "Out of stock".
 *
 * The previous stock figure of every touched product is written to a rollback
 * file first — that matters here, because most of these products had real
 * stock numbers that this overwrites.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/set-stock-priced.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/set-stock-priced.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/set-stock-priced.cjs --only-zero --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/set-stock-priced.cjs --rollback <file>
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const APPLY = process.argv.includes("--apply");
const ONLY_ZERO = process.argv.includes("--only-zero");
const ROLLBACK_IDX = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX > -1 ? process.argv[ROLLBACK_IDX + 1] : null;

const STOCK_LEVEL = 1000;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");

  if (ROLLBACK_FILE) {
    const rows = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    let n = 0;
    for (const r of rows) {
      await Products.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        { $set: { stock: r.stock } },
      );
      n++;
    }
    console.log(`Rolled back stock on ${n} products.`);
    await mongoose.disconnect();
    return;
  }

  const filter = {
    price: { $gt: 0 },
    category: { $exists: true, $nin: [null, ""] },
    ...(ONLY_ZERO
      ? { $or: [{ stock: { $lte: 0 } }, { stock: null }, { stock: { $exists: false } }] }
      : {}),
  };

  const products = await Products.find(filter)
    .project({ _id: 1, stock: 1 })
    .toArray();

  const zeroCount = products.filter((p) => !(p.stock > 0)).length;

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`scope        : ${ONLY_ZERO ? "out-of-stock only" : "all priced products"}`);
  console.log(`stock level  : ${STOCK_LEVEL}`);
  console.log(`products     : ${products.length}`);
  console.log(`  of which currently at zero : ${zeroCount}`);
  console.log(`  of which have real stock   : ${products.length - zeroCount}`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const backup = products.map((p) => ({
    _id: String(p._id),
    stock: typeof p.stock === "number" ? p.stock : 0,
  }));
  const file = path.join(process.cwd(), `rollback-stock-${backup.length}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRollback file: ${path.basename(file)}`);

  const res = await Products.updateMany(filter, {
    $set: { stock: STOCK_LEVEL, stockStatus: "in_stock" },
  });
  console.log(`Products updated: ${res.modifiedCount}`);
  console.log(
    `\nTo undo: node --require ./scripts/mongo-dns.cjs scripts/set-stock-priced.cjs --rollback ${path.basename(file)}`,
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

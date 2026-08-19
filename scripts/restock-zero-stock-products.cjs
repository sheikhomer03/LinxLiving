/**
 * Give every out-of-stock product a working stock level.
 *
 * Stock defaulted to 0 at every level, so a product whose importer or form
 * omitted the figure was saved as out of stock and disappeared from the
 * storefront. This sets those back to DEFAULT_STOCK and clears the flags that
 * travel with them, at the product, variant and option level.
 *
 * Touched only where the figure is missing or <= 0:
 *   stock            -> 1000
 *   variants[].stock -> 1000
 *   bases/shades/typeOptions[].stock -> 1000
 *   isOutOfStock     -> false
 *   stockStatus      -> in_stock   (only when it currently says out_of_stock)
 *
 * Prices, names, images and anything already carrying stock are untouched.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/restock-zero-stock-products.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/restock-zero-stock-products.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/restock-zero-stock-products.cjs --rollback <file.json>
 *
 *   STOCK=1000   level to set
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;
const STOCK = Number(process.env.STOCK || 1000);

/** Sub-document arrays that carry their own stock figure. */
const OPTION_ARRAYS = ["variants", "bases", "shades", "typeOptions"];

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const P = db.collection("products");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    let n = 0;
    for (const p of data.products || []) {
      const set = { stock: p.stock, isOutOfStock: p.isOutOfStock };
      if (p.stockStatus !== undefined) set.stockStatus = p.stockStatus;
      for (const key of OPTION_ARRAYS) if (p[key] !== undefined) set[key] = p[key];
      await P.updateOne({ _id: new mongoose.Types.ObjectId(p._id) }, { $set: set });
      n += 1;
    }
    console.log(`rolled back ${n} products`);
    await mongoose.disconnect();
    return;
  }

  // A product can be in stock overall while a variant, base or shade sits at
  // zero and blocks that choice, so the sub-documents are matched too.
  const zeroSub = (key) => ({
    [key]: {
      $elemMatch: { $or: [{ stock: { $lte: 0 } }, { stock: null }, { stock: { $exists: false } }] },
    },
  });

  const filter = {
    $or: [
      { stock: { $lte: 0 } },
      { stock: null },
      { stock: { $exists: false } },
      { isOutOfStock: true },
      { stockStatus: "out_of_stock" },
      ...OPTION_ARRAYS.map(zeroSub),
    ],
  };

  const products = await P.find(filter)
    .project({
      name: 1, stock: 1, isOutOfStock: 1, stockStatus: 1,
      variants: 1, bases: 1, shades: 1, typeOptions: 1,
    })
    .toArray();
  console.log(`products with a zero-stock figure somewhere: ${products.length}`);

  const updates = [];
  const counts = { stock: 0, flag: 0, status: 0 };
  const optionRows = {};

  for (const p of products) {
    const set = {};
    const before = { _id: String(p._id) };

    const cur = Number(p.stock);
    if (!Number.isFinite(cur) || cur <= 0) {
      before.stock = p.stock === undefined ? null : p.stock;
      set.stock = STOCK;
      counts.stock += 1;
    }
    if (p.isOutOfStock === true) {
      before.isOutOfStock = true;
      set.isOutOfStock = false;
      counts.flag += 1;
    }
    if (p.stockStatus === "out_of_stock") {
      before.stockStatus = p.stockStatus;
      set.stockStatus = "in_stock";
      counts.status += 1;
    }

    for (const key of OPTION_ARRAYS) {
      const list = p[key];
      if (!Array.isArray(list) || !list.length) continue;
      const needs = list.some((v) => {
        const n = Number(v && v.stock);
        return !Number.isFinite(n) || n <= 0;
      });
      if (!needs) continue;
      before[key] = list;
      set[key] = list.map((v) => {
        const n = Number(v && v.stock);
        return Number.isFinite(n) && n > 0 ? v : { ...v, stock: STOCK };
      });
      optionRows[key] = (optionRows[key] || 0) + 1;
    }

    if (Object.keys(set).length) updates.push({ _id: p._id, set, before, name: p.name });
  }

  console.log(`\nto update            : ${updates.length}`);
  console.log(`  stock -> ${STOCK}     : ${counts.stock}`);
  console.log(`  isOutOfStock cleared : ${counts.flag}`);
  console.log(`  stockStatus in_stock : ${counts.status}`);
  for (const [k, v] of Object.entries(optionRows)) console.log(`  ${k}[] restocked     : ${v}`);

  console.log("\nfirst 10:");
  for (const u of updates.slice(0, 10)) {
    const bits = Object.entries(u.set)
      .map(([k, v]) => (Array.isArray(v) ? `${k}[${v.length}]` : `${k}=${v}`))
      .join("  ");
    console.log(`   ${String(u.name).slice(0, 42).padEnd(44)} ${bits}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = { products: updates.map((u) => u.before) };
  const now = new Date();
  const ops = updates.map((u) => ({
    updateOne: { filter: { _id: u._id }, update: { $set: { ...u.set, updatedAt: now } } },
  }));
  for (let i = 0; i < ops.length; i += 200) {
    await P.bulkWrite(ops.slice(i, i + 200), { ordered: false });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-restock-zero-stock-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
  console.log(`\napplied: ${updates.length} products\nrollback: ${file}`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

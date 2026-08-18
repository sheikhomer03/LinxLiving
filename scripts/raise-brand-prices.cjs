/**
 * Raise one brand's sell prices by a percentage.
 *
 * Both levels have to move together. `product.price` is what the card and the
 * PDP headline show, but Shopify's checkout charges the *variant*, so raising
 * only the product price would change every displayed figure and none of the
 * money actually taken.
 *
 * `containerPrice` is deliberately left alone. It is the factory's per-unit
 * quote for an order filling a 1×40HQ container — a supplier cost, not our
 * sell price — and marking it up would corrupt a purchasing record. Same for
 * `costPrice` if one is ever set.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/raise-brand-prices.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/raise-brand-prices.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/raise-brand-prices.cjs --rollback <file.json>
 *
 *   PERCENT=40              how much to add (default 40)
 *   BRAND="Oscar pergola"   which brand (default AlunoTec)
 *
 * The rollback file records the exact previous figure for every product and
 * variant it touched, so a raise applied to the wrong brand or at the wrong
 * percentage is one command away from being undone.
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;
const PERCENT = Number(process.env.PERCENT ?? 40);
const BRAND = process.env.BRAND || "AlunoTec";

const factor = 1 + PERCENT / 100;

/** Money, to the penny. 1406 → 1968.4, as the figures are quoted. */
const raise = (v) => Math.round(Number(v) * factor * 100) / 100;

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let n = 0;
  for (const p of data.products || []) {
    const set = { price: p.price };
    (p.variants || []).forEach((v) => {
      set[`variants.${v.index}.price`] = v.price;
    });
    await db
      .collection("products")
      .updateOne({ _id: new mongoose.Types.ObjectId(p._id) }, { $set: set });
    n += 1;
  }
  console.log(`rolled back ${n} product(s) to their previous prices`);
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const col = db.collection("products");

  if (ROLLBACK) {
    await runRollback(db, ROLLBACK);
    await mongoose.disconnect();
    return;
  }

  const brand = await db
    .collection("brands")
    .findOne({ name: new RegExp(`^${BRAND}$`, "i") });
  if (!brand) throw new Error(`Brand "${BRAND}" not found`);

  const products = await col
    .find({ $or: [{ brand: brand._id }, { brands: brand._id }] })
    .sort({ price: 1 })
    .toArray();

  console.log(`${brand.name}: ${products.length} products, +${PERCENT}% (×${factor})\n`);

  const plan = [];
  let variantCount = 0;

  for (const p of products) {
    const from = Number(p.price) || 0;
    if (!from) {
      console.log(`  ! ${String(p.name).slice(0, 46)} — no price, skipped`);
      continue;
    }
    const to = raise(from);
    const variants = (p.variants || [])
      .map((v, index) => ({ index, name: v.name, from: Number(v.price) || 0 }))
      .filter((v) => v.from > 0)
      .map((v) => ({ ...v, to: raise(v.from) }));

    variantCount += variants.length;
    plan.push({ doc: p, from, to, variants });

    console.log(
      `  ${String(p.name).replace(`${brand.name} `, "").slice(0, 42).padEnd(44)} £${from} -> £${to}`,
    );
    for (const v of variants) {
      console.log(`      ${String(v.name).slice(0, 30).padEnd(32)} £${v.from} -> £${v.to}`);
    }
  }

  console.log(
    `\n${plan.length} product prices and ${variantCount} variant prices would change.` +
      `\ncontainerPrice left untouched (supplier bulk quote, not a sell price).`,
  );

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = { percent: PERCENT, products: [] };

  for (const item of plan) {
    const set = { price: item.to };
    for (const v of item.variants) set[`variants.${v.index}.price`] = v.to;

    rollback.products.push({
      _id: String(item.doc._id),
      name: item.doc.name,
      price: item.from,
      variants: item.variants.map((v) => ({ index: v.index, price: v.from })),
    });

    await col.updateOne({ _id: item.doc._id }, { $set: set });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(
    process.cwd(),
    `rollback-prices-${brand.slug || "brand"}-${PERCENT}pc-${stamp}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));

  console.log(
    `\napplied to ${plan.length} products / ${variantCount} variants` +
      `\nrollback: ${file}` +
      `\n\nShopify still holds the old prices — push them with:` +
      `\n  BRAND="${brand.name}" node --require ./scripts/mongo-dns.cjs scripts/sync-all-products-to-shopify.cjs\n`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

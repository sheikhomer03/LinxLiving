/**
 * Correct the 36 legacy discounted products (the original 33 pre-dating this
 * migration, plus overlap) whose stored "was" price doesn't precisely match
 * their own specs.salePercent label — e.g. labeled 15% off but the stored
 * compare-at only works out to ~13%. The badge already always displays the
 * stored salePercent (not a derived ratio), so customers never saw a wrong
 * number — this only tightens the underlying "was" price data.
 *
 * `price` (what the customer pays) is never touched. Only whichever field
 * the product already uses for its compare-at (specs.shopifyCompareAt or
 * specs.compareAtPrice) is corrected, to price / (1 - salePercent/100).
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-legacy-discount-ratios.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-legacy-discount-ratios.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-legacy-discount-ratios.cjs --rollback <file>
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const APPLY = process.argv.includes("--apply");
const ROLLBACK_IDX = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX > -1 ? process.argv[ROLLBACK_IDX + 1] : null;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");

  if (ROLLBACK_FILE) {
    const rows = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    let n = 0;
    for (const r of rows) {
      await Products.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        { $set: { [`specs.${r.field}`]: r.oldCompareAt } },
      );
      n++;
    }
    console.log(`Rolled back ${n} products.`);
    await mongoose.disconnect();
    return;
  }

  const docs = await Products.find(
    { "specs.salePercent": { $gt: 0 } },
    { projection: { name: 1, price: 1, specs: 1 } },
  ).toArray();

  const plan = [];
  for (const p of docs) {
    const price = Number(p.price);
    const salePercent = Number(p.specs?.salePercent);
    const field = p.specs?.shopifyCompareAt != null ? "shopifyCompareAt" : "compareAtPrice";
    const compareAt = Number(p.specs?.[field]);
    if (!Number.isFinite(compareAt) || compareAt <= 0) continue;
    if (compareAt <= price) continue;
    const impliedDiscount = (1 - price / compareAt) * 100;
    if (Math.abs(impliedDiscount - salePercent) <= 1.0) continue;
    const correctCompareAt = round2(price / (1 - salePercent / 100));
    plan.push({
      id: String(p._id),
      name: p.name,
      field,
      price,
      oldCompareAt: compareAt,
      newCompareAt: correctCompareAt,
    });
  }

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`products to fix: ${plan.length}`);
  console.log("Sample:", plan.slice(0, 5));

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  if (plan.length === 0) {
    console.log("Nothing to update.");
    await mongoose.disconnect();
    return;
  }

  const file = path.join(
    process.cwd(),
    `rollback-legacy-discount-ratios-${plan.length}-${Date.now()}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(plan, null, 2));
  console.log(`\nRollback file: ${path.basename(file)}`);

  let updated = 0;
  for (const row of plan) {
    await Products.updateOne(
      { _id: new mongoose.Types.ObjectId(row.id) },
      { $set: { [`specs.${row.field}`]: row.newCompareAt, updatedAt: new Date() } },
    );
    updated++;
  }

  console.log(`\nProducts updated: ${updated}`);
  console.log(
    `To undo: node --require ./scripts/mongo-dns.cjs scripts/fix-legacy-discount-ratios.cjs --rollback ${path.basename(file)}`,
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Audit: for every product with specs.salePercent > 0, check whether its
 * "was" price (specs.shopifyCompareAt, else specs.compareAtPrice) actually
 * matches price / (1 - salePercent/100). Read-only — no writes.
 *
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/audit-was-price-mismatch.cjs
 */

const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");

  const cursor = Products.find({ "specs.salePercent": { $gt: 0 }, price: { $gt: 0 } }).project({
    _id: 1,
    name: 1,
    price: 1,
    "specs.salePercent": 1,
    "specs.compareAtPrice": 1,
    "specs.shopifyCompareAt": 1,
  });

  let total = 0;
  let noWasField = 0;
  let mismatched = 0;
  let ok = 0;
  const mismatchSamples = [];

  for await (const p of cursor) {
    total++;
    const price = Number(p.price);
    const salePct = Number(p.specs.salePercent);
    const field = p.specs.shopifyCompareAt != null ? "shopifyCompareAt" : (p.specs.compareAtPrice != null ? "compareAtPrice" : null);
    if (!field) {
      noWasField++;
      continue;
    }
    const was = Number(p.specs[field]);
    const expected = round2(price / (1 - salePct / 100));
    const diff = Math.abs(was - expected);
    if (diff > 0.5) {
      mismatched++;
      if (mismatchSamples.length < 15) {
        mismatchSamples.push({
          id: String(p._id),
          name: p.name,
          price,
          salePct,
          field,
          was,
          expected,
        });
      }
    } else {
      ok++;
    }
  }

  console.log(`Total products with salePercent > 0: ${total}`);
  console.log(`  no was-price field at all: ${noWasField}`);
  console.log(`  was-price consistent with salePercent: ${ok}`);
  console.log(`  was-price MISMATCHED: ${mismatched}`);
  console.log("\nSample mismatches:");
  console.log(JSON.stringify(mismatchSamples, null, 2));

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

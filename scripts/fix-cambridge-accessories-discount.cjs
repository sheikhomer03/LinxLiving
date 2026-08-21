/**
 * Re-rounds the discount % on the 5 Cambridge Skylights accessory products
 * to a clean value (20 / 25 / 30) instead of an arbitrary 20-30 integer —
 * nothing else about these products changes. `price` (what's charged) is
 * untouched; only specs.salePercent and the derived specs.compareAtPrice
 * ("was" price) are recalculated.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-cambridge-accessories-discount.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-cambridge-accessories-discount.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");

const IDS = [
  "6a7dabb6f230ebff958b4bfb",
  "6a7dabb8f230ebff958b4bfc",
  "6a7dabbaf230ebff958b4bfd",
  "6a7dabbbf230ebff958b4bfe",
  "6a7dabbdf230ebff958b4bff",
];

const CLEAN_DISCOUNTS = [20, 25, 30];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");
  const { ObjectId } = require("mongodb");

  for (const id of IDS) {
    const _id = new ObjectId(id);
    const doc = await productsCol.findOne({ _id });
    if (!doc) {
      console.error(`✗ not found: ${id}`);
      continue;
    }

    const price = round2(doc.price);
    const discountPercent = pick(CLEAN_DISCOUNTS);
    const compareAtPrice = round2(price / (1 - discountPercent / 100));

    const $set = {
      "specs.salePercent": discountPercent,
      "specs.compareAtPrice": compareAtPrice,
      updatedAt: new Date(),
    };

    console.log(
      `${APPLY ? "✓" : "[dry]"} ${doc.name}: price=£${price} was=£${compareAtPrice} (${discountPercent}% off)`,
    );

    if (APPLY) {
      await productsCol.updateOne({ _id }, { $set });
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

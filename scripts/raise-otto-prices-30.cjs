/**
 * Raise all Otto Tiles product prices by 30%.
 *   node --require ./scripts/mongo-dns.cjs scripts/raise-otto-prices-30.cjs
 *   DRY_RUN=1 node --require ./scripts/mongo-dns.cjs scripts/raise-otto-prices-30.cjs
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const FACTOR = 1.3;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "otto-tiles" });
  if (!brand) throw new Error("Otto Tiles brand not found");

  const products = await db
    .collection("products")
    .find({ $or: [{ brand: brand._id }, { brands: brand._id }] })
    .project({ name: 1, price: 1, compareAtPrice: 1, specs: 1 })
    .toArray();

  console.log(
    `Otto products: ${products.length}${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  let updated = 0;
  let skipped = 0;
  const samples = [];

  for (const p of products) {
    const oldPrice = Number(p.price);
    if (!Number.isFinite(oldPrice) || oldPrice <= 0) {
      skipped++;
      continue;
    }
    const newPrice = round2(oldPrice * FACTOR);
    if (newPrice === oldPrice) {
      skipped++;
      continue;
    }

    const set = {
      price: newPrice,
      updatedAt: new Date(),
      "specs.priceRaised30At": new Date().toISOString(),
      "specs.priceBeforeRaise30": oldPrice,
    };

    const compareAt = Number(p.compareAtPrice);
    if (Number.isFinite(compareAt) && compareAt > 0) {
      set.compareAtPrice = round2(compareAt * FACTOR);
    }

    if (samples.length < 5) {
      samples.push({ name: p.name, from: oldPrice, to: newPrice });
    }

    if (!DRY_RUN) {
      await db.collection("products").updateOne({ _id: p._id }, { $set: set });
    }
    updated++;
  }

  console.log("Samples:", samples);
  console.log(`Updated: ${updated}, skipped: ${skipped}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

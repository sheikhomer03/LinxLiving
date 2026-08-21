/**
 * The Fitters Pack description's DOW 895 / DOW 791 links still carried
 * target="_blank" from the original scraped HTML (meant for opening an
 * external site) — now that they point to internal product pages, that
 * opens a stray new tab. Strips target/rel from just those two links.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-cambridge-fitterspack-newtab.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-cambridge-fitterspack-newtab.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const FITTERS_PACK_ID = "6a7dabbdf230ebff958b4bff";

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");
  const { ObjectId } = require("mongodb");

  const _id = new ObjectId(FITTERS_PACK_ID);
  const doc = await productsCol.findOne({ _id });
  if (!doc) {
    console.error(`✗ not found: ${FITTERS_PACK_ID}`);
    await mongoose.disconnect();
    return;
  }

  const description = doc.description
    .replace(
      '<a href="/products/6a7dabbaf230ebff958b4bfd" target="_blank">',
      '<a href="/products/6a7dabbaf230ebff958b4bfd">',
    )
    .replace(
      '<a href="/products/6a7dabbbf230ebff958b4bfe" target="_blank" rel="noopener noreferrer">',
      '<a href="/products/6a7dabbbf230ebff958b4bfe">',
    );

  console.log("--- new description ---");
  console.log(description);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  await productsCol.updateOne(
    { _id },
    { $set: { description, updatedAt: new Date() } },
  );
  console.log(`\n✓ updated ${doc.name} (${FITTERS_PACK_ID})`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

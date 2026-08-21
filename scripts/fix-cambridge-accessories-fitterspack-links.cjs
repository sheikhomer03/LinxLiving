/**
 * The Fitters Pack description (scraped verbatim from Cambridge Skylights)
 * links its 3 contents back to the SOURCE site. Repoints those 3 links to
 * the matching products already imported on this site instead. Touches
 * only the Fitters Pack product's description — nothing else.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-cambridge-accessories-fitterspack-links.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-cambridge-accessories-fitterspack-links.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const FITTERS_PACK_ID = "6a7dabbdf230ebff958b4bff";

const LINK_REPLACEMENTS = [
  {
    // 1 x 10m Structural Tape
    match:
      /href="https:\/\/cambridgeskylights\.uk\/products\/structural-glazing-spacer-tape[^"]*"/,
    replacement: 'href="/products/6a7dabb8f230ebff958b4bfc"',
  },
  {
    // 1 x 310ml DOW 895
    match:
      /href="https:\/\/cambridgeskylights\.uk\/products\/dow-corning-dowsil-895-structural-glazing[^"]*"/,
    replacement: 'href="/products/6a7dabbaf230ebff958b4bfd"',
  },
  {
    // 1 x 310ml Dow 791
    match:
      /href="https:\/\/cambridgeskylights\.uk\/products\/dow-corning-dowsil-791-weather-proofing[^"]*"/,
    replacement: 'href="/products/6a7dabbbf230ebff958b4bfe"',
  },
];

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

  let description = doc.description;
  let changed = 0;
  for (const { match, replacement } of LINK_REPLACEMENTS) {
    if (match.test(description)) {
      description = description.replace(match, replacement);
      changed++;
    }
  }

  console.log(`Matched ${changed}/${LINK_REPLACEMENTS.length} links`);
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

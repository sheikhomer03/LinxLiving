/**
 * Strips the word "Cambridge" from the name and description of the 32
 * Cambridge Skylights (HorizonLite) products — nothing else touched (brand
 * record, specs, images, pricing, options all stay as-is).
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/remove-cambridge-branding.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/remove-cambridge-branding.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");

function stripCambridge(text) {
  return String(text || "")
    .replace(/\bcambridge\b\s*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+| [ \t]+$/gm, "")
    .trim();
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const targets = await productsCol
    .find({ department: "rooflights-and-glass", "specs.source": "cambridge-skylights" })
    .project({ name: 1, description: 1 })
    .toArray();
  console.log(`Found ${targets.length} skylight products`);

  let changed = 0;
  for (const doc of targets) {
    const newName = stripCambridge(doc.name);
    const newDescription = stripCambridge(doc.description);
    const nameChanged = newName !== doc.name;
    const descChanged = newDescription !== doc.description;

    if (!nameChanged && !descChanged) {
      console.log(`- no "Cambridge" found: ${doc.name}`);
      continue;
    }

    changed++;
    console.log(
      `${APPLY ? "✓" : "[dry]"} "${doc.name}" -> "${newName}"${descChanged ? " (description also updated)" : ""}`,
    );

    if (APPLY) {
      await productsCol.updateOne(
        { _id: doc._id },
        { $set: { name: newName, description: newDescription, updatedAt: new Date() } },
      );
    }
  }

  console.log(`\n${changed} product(s) ${APPLY ? "updated" : "would be updated"}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

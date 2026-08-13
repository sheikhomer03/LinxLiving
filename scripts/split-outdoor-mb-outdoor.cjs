/**
 * The Outdoor Living menu's Decking/Cladding/Fencing links all point at the
 * same category (mb-outdoor), so all 21 products show under all 3. This
 * assigns each product a subCategory based on its own name (Extruda
 * Deck/Natura Deck -> decking, Extruda Clad -> cladding, Extruda Fence ->
 * fencing), so each link can be pointed at its own subset — see the matching
 * megaMenu.ts edit. Only touches products in department=outdoor-living,
 * category=mb-outdoor.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/split-outdoor-mb-outdoor.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/split-outdoor-mb-outdoor.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");

function classify(name) {
  const n = String(name || "").toLowerCase();
  if (/\bdeck\b|decking/.test(n)) return "decking";
  if (/\bclad\b|cladding/.test(n)) return "cladding";
  if (/\bfence\b|fencing/.test(n)) return "fencing";
  return null;
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const products = await productsCol
    .find({ department: "outdoor-living", category: "mb-outdoor" })
    .project({ name: 1, subCategory: 1 })
    .toArray();
  console.log(`Found ${products.length} products`);

  const counts = { decking: 0, cladding: 0, fencing: 0, unclassified: 0 };
  for (const p of products) {
    const sub = classify(p.name);
    if (!sub) {
      counts.unclassified++;
      console.log(`? UNCLASSIFIED: ${p.name}`);
      continue;
    }
    counts[sub]++;
    console.log(`${APPLY ? "✓" : "[dry]"} ${sub.padEnd(9)} <- ${p.name}`);
    if (APPLY) {
      await productsCol.updateOne(
        { _id: p._id },
        { $set: { subCategory: sub, updatedAt: new Date() } },
      );
    }
  }

  console.log(
    `\ndecking=${counts.decking} cladding=${counts.cladding} fencing=${counts.fencing} unclassified=${counts.unclassified}`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

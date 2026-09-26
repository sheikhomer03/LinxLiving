/**
 * Put merged products in the cluster their brand lives in.
 *
 * A brand's `dataCluster` (on the brand document, in the primary) decides
 * where all its products live; see src/lib/mongoCluster.ts. After the merges
 * two products broke that:
 *   - the Luxeline fence panel was left in both clusters (identical copies),
 *     so listings showed it twice and the page read the primary copy;
 *   - "Epoxy Grout and Glitter" was rebuilt with no brand at all, although it
 *     comes from tilesporcelain.co.uk like the rest of Tiles Porcelain.
 *
 *   node scripts/fix-merged-product-clusters.cjs           # dry run
 *   node scripts/fix-merged-product-clusters.cjs --apply   # write (backs up first)
 */
require("dotenv").config({ path: ".env.local" });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));

const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId, BSON } = require("mongodb");

const APPLY = process.argv.includes("--apply");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const FENCE_ID = new ObjectId("6ab3b88453747b87fb838827");
const GROUT_ID = new ObjectId("6ab647a65465da0a4ff72483");

async function main() {
  const primary = new MongoClient(process.env.MONGODB_URI);
  const secondary = new MongoClient(process.env.MONGODB_URL2);
  await primary.connect();
  await secondary.connect();
  const pCol = primary.db("test").collection("products");
  const sCol = secondary.db("test").collection("products");
  const backup = [];

  // 1. Fence panel: its brand lives in the secondary — drop the primary copy,
  //    but only once the secondary copy is confirmed present.
  const fence = await pCol.findOne({ _id: FENCE_ID });
  const brand = fence && (await primary.db("test").collection("brands").findOne({ _id: fence.brand }));
  const kept = await sCol.findOne({ _id: FENCE_ID }, { projection: { _id: 1 } });
  if (!fence) console.log("Fence panel: no primary copy — nothing to do.");
  else if (brand?.dataCluster !== "secondary" || !kept) {
    console.log("Fence panel: brand not on secondary or secondary copy missing — left alone.");
  } else {
    console.log(`Fence panel: delete primary copy (brand ${brand.name} lives in secondary; secondary copy present).`);
    backup.push(BSON.EJSON.stringify({ cluster: "primary", doc: fence }, { relaxed: false }));
    if (APPLY) await pCol.deleteOne({ _id: FENCE_ID });
  }

  // 2. Grout: brand from its source site, as its Tiles Porcelain siblings have.
  const grout = await sCol.findOne({ _id: GROUT_ID });
  const tp = await primary.db("test").collection("brands").findOne({ slug: "tiles-porcelain" });
  if (!grout || !tp) console.log("Grout or Tiles Porcelain brand not found — left alone.");
  else if (!/tilesporcelain\.co\.uk/.test(grout.sourceUrl || "")) console.log("Grout source is not tilesporcelain.co.uk — left alone.");
  else if (grout.brand) console.log("Grout already has a brand — left alone.");
  else {
    console.log(`Grout: set brand → ${tp.name} (${tp._id}, cluster ${tp.dataCluster}).`);
    backup.push(BSON.EJSON.stringify({ cluster: "secondary", doc: grout }, { relaxed: false }));
    if (APPLY) await sCol.updateOne({ _id: GROUT_ID }, { $set: { brand: tp._id, brands: [tp._id] } });
  }

  if (APPLY && backup.length) {
    const file = path.join(__dirname, `../backups/pre-cluster-fix-${STAMP}.ejson`);
    fs.writeFileSync(file, backup.join("\n") + "\n");
    console.log(`Previous versions saved to ${file}`);
  }
  if (!APPLY) console.log("Dry run — nothing written. Re-run with --apply to save.");
  await primary.close();
  await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

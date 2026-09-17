/**
 * Move one brand's products to the secondary cluster.
 *
 * Order matters: copy, verify, flip the registry, and only then delete from
 * the primary. Nothing is removed until the secondary has been confirmed to
 * hold the same number of documents with the same ids, so an interrupted run
 * leaves duplicated data rather than missing data.
 *
 * `_id` values are preserved. Products are referenced by ObjectId from orders,
 * wishlists, `relatedProductIds` and the Shopify link, so a copy that
 * reassigned ids would break all of them.
 *
 * The brand document itself stays in the primary — that is where the routing
 * registry lives, and it is what `clusterForBrand` reads.
 *
 * Env:
 *   BRAND=slug     brand to move (default "drench")
 *   DRY_RUN=1      report only
 *   SKIP_DELETE=1  copy and verify, leave the primary copy in place
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_SLUG = process.env.BRAND || "drench";
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_DELETE = process.env.SKIP_DELETE === "1";
const BATCH = 200;

async function main() {
  const uri2 = process.env.MONGODB_URL2;
  if (!uri2) throw new Error("MONGODB_URL2 is not set");

  // Primary, through the shared helper that handles this machine's DNS.
  const { db: primary } = await connectMongo();

  // Secondary, as its own connection on the same process.
  const secConn = await mongoose
    .createConnection(uri2, { serverSelectionTimeoutMS: 30000 })
    .asPromise();
  const secondary = secConn.db;

  console.log("primary   : " + primary.databaseName);
  console.log("secondary : " + secondary.databaseName);
  console.log("brand     : " + BRAND_SLUG);
  console.log(DRY_RUN ? "mode      : DRY RUN" : "");
  console.log("");

  const brand = await primary.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found in primary: " + BRAND_SLUG);

  const P = primary.collection("products");
  const S = secondary.collection("products");
  const filter = { brand: brand._id };

  const sourceCount = await P.countDocuments(filter);
  const alreadyThere = await S.countDocuments(filter);
  console.log("products in primary   : " + sourceCount);
  console.log("already in secondary  : " + alreadyThere);
  console.log("");

  if (!sourceCount) { console.log("nothing to migrate"); process.exit(0); }
  if (DRY_RUN) {
    console.log("[dry] would copy " + sourceCount + " products, verify, flip the");
    console.log("[dry] registry to secondary, then delete from primary");
    process.exit(0);
  }

  // ---- 1. copy -----------------------------------------------------------
  console.log("1/4  copying");
  let copied = 0, lastId = null;
  for (;;) {
    const q = Object.assign({}, filter);
    if (lastId) q._id = { $gt: lastId };
    const page = await P.find(q).sort({ _id: 1 }).limit(BATCH).toArray();
    if (!page.length) break;
    lastId = page[page.length - 1]._id;

    // Replace rather than insert, so a re-run after an interruption is safe.
    await S.bulkWrite(
      page.map((doc) => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      })),
      { ordered: false },
    );
    copied += page.length;
    if (copied % 1000 < BATCH) console.log("     " + copied + "/" + sourceCount);
  }
  console.log("     copied " + copied);

  // ---- 2. verify ---------------------------------------------------------
  console.log("2/4  verifying");
  const destCount = await S.countDocuments(filter);
  console.log("     secondary now holds " + destCount + " of " + sourceCount);

  // Ids must match exactly, not just the totals.
  const srcIds = (await P.find(filter).project({ _id: 1 }).toArray()).map((d) =>
    String(d._id),
  );
  const dstIds = new Set(
    (await S.find(filter).project({ _id: 1 }).toArray()).map((d) => String(d._id)),
  );
  const missing = srcIds.filter((id) => !dstIds.has(id));
  console.log("     ids missing in secondary: " + missing.length);

  if (destCount < sourceCount || missing.length) {
    console.log("");
    console.log("VERIFY FAILED — primary left untouched. Re-run to finish the copy.");
    await secConn.close();
    process.exit(1);
  }
  console.log("     verified");

  // ---- 3. flip the registry ---------------------------------------------
  console.log("3/4  pointing the brand at the secondary");
  await primary
    .collection("brands")
    .updateOne({ _id: brand._id }, { $set: { dataCluster: "secondary" } });
  console.log("     brands." + BRAND_SLUG + ".dataCluster = secondary");

  // ---- 4. remove from the primary ---------------------------------------
  if (SKIP_DELETE) {
    console.log("4/4  SKIP_DELETE set — primary copy kept");
  } else {
    console.log("4/4  deleting from primary");
    const before = await primary.stats();
    const r = await P.deleteMany(filter);
    const after = await primary.stats();
    console.log("     deleted " + r.deletedCount);
    console.log("     primary billed: " +
      ((before.dataSize + before.indexSize) / 1048576).toFixed(2) + " MB -> " +
      ((after.dataSize + after.indexSize) / 1048576).toFixed(2) + " MB");
  }

  console.log("");
  console.log("primary products   : " + (await P.countDocuments(filter)));
  console.log("secondary products : " + (await S.countDocuments(filter)));

  await secConn.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

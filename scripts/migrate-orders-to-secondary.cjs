/**
 * Move the orders collection to the secondary cluster.
 *
 * Orders are not split by brand. A basket can hold products from both
 * clusters, and half an order is not an order — it has no single total and
 * no single status — so all of them live in one place, and that place is the
 * side with room to grow.
 *
 * Copy, verify ids, then delete. An interrupted run leaves a duplicate,
 * which can be re-run; it never leaves a hole.
 *
 * `_id` is preserved: order ids appear in emails, Shopify links, purchase
 * orders and customer-facing tracking URLs.
 *
 * Env:
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

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_DELETE = process.env.SKIP_DELETE === "1";
const BATCH = 200;

async function main() {
  const uri2 = process.env.MONGODB_URL2;
  if (!uri2) throw new Error("MONGODB_URL2 is not set");

  const { db: primary } = await connectMongo();
  const secConn = await mongoose
    .createConnection(uri2, { serverSelectionTimeoutMS: 30000 })
    .asPromise();
  const secondary = secConn.db;

  console.log("primary   : " + primary.databaseName);
  console.log("secondary : " + secondary.databaseName);
  console.log(DRY_RUN ? "mode      : DRY RUN" : "mode      : LIVE");
  console.log("");

  const P = primary.collection("orders");
  const S = secondary.collection("orders");

  const sourceCount = await P.countDocuments({});
  const alreadyThere = await S.countDocuments({});
  console.log("orders in primary    : " + sourceCount);
  console.log("already in secondary : " + alreadyThere);
  console.log("");

  if (!sourceCount) {
    console.log("nothing to migrate");
    await secConn.close();
    process.exit(0);
  }
  if (DRY_RUN) {
    console.log("[dry] would copy " + sourceCount + " orders, verify ids, then");
    console.log("[dry] delete them from the primary");
    await secConn.close();
    process.exit(0);
  }

  // ---- 1. copy -----------------------------------------------------------
  console.log("1/3  copying");
  let copied = 0;
  let lastId = null;
  for (;;) {
    const q = lastId ? { _id: { $gt: lastId } } : {};
    const page = await P.find(q).sort({ _id: 1 }).limit(BATCH).toArray();
    if (!page.length) break;
    lastId = page[page.length - 1]._id;

    await S.bulkWrite(
      page.map((doc) => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      })),
      { ordered: false },
    );
    copied += page.length;
  }
  console.log("     copied " + copied);

  // ---- 2. verify ---------------------------------------------------------
  console.log("2/3  verifying");
  const srcIds = (await P.find({}).project({ _id: 1 }).toArray()).map((d) =>
    String(d._id),
  );
  const dstIds = new Set(
    (await S.find({}).project({ _id: 1 }).toArray()).map((d) => String(d._id)),
  );
  const missing = srcIds.filter((id) => !dstIds.has(id));
  console.log("     secondary holds " + dstIds.size + ", ids missing: " + missing.length);

  if (missing.length) {
    console.log("");
    console.log("VERIFY FAILED - primary left untouched. Re-run to finish the copy.");
    await secConn.close();
    process.exit(1);
  }
  console.log("     verified");

  // Keep a copy on disk before removing the originals.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dump = path.join(__dirname, "..", "backup-orders-" + stamp + ".json");
  fs.writeFileSync(dump, JSON.stringify(await P.find({}).toArray(), null, 1));
  console.log("     backup written: " + path.basename(dump));

  // ---- 3. remove from the primary ---------------------------------------
  if (SKIP_DELETE) {
    console.log("3/3  SKIP_DELETE set - primary copy kept");
  } else {
    console.log("3/3  deleting from primary");
    const before = await primary.stats();
    const r = await P.deleteMany({});
    const after = await primary.stats();
    console.log("     deleted " + r.deletedCount);
    console.log(
      "     primary billed: " +
        ((before.dataSize + before.indexSize) / 1048576).toFixed(2) +
        " MB -> " +
        ((after.dataSize + after.indexSize) / 1048576).toFixed(2) +
        " MB",
    );
  }

  console.log("");
  console.log("primary orders   : " + (await P.countDocuments({})));
  console.log("secondary orders : " + (await S.countDocuments({})));

  await secConn.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Remove the duplicate products the inbound webhook created from our own pushes.
 *
 * When a bulk push runs with `products/create` still registered, Shopify
 * announces each product back to us before the push has written its GID to
 * Mongo. The inbound handler looks the GID up, finds nothing, and concludes the
 * product was authored in Shopify — so it inserts a second Mongo row pointing at
 * the same Shopify product as the row that created it.
 *
 * The echo is identifiable: two or more Mongo products sharing one
 * `shopifyProductId`. The original is the older row — it carries the supplier
 * data the echo never had (SKUs, variants, source handles, taxonomy), because
 * the echo was built from what Shopify knew, which is only what we had just
 * sent. So the oldest row by `createdAt` is kept and the rest are removed.
 *
 * Dry by default. Deletions are written to a rollback file first.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/dedupe-shopify-echo-products.cjs
 *   APPLY=1 node --require ./scripts/mongo-dns.cjs scripts/dedupe-shopify-echo-products.cjs
 */
const path = require("path");
const fs = require("fs");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.env.APPLY === "1";

(async () => {
  const conn = await connectMongo();
  const col = conn.db.collection("products");

  const groups = await col
    .aggregate(
      [
        { $match: { shopifyProductId: { $nin: [null, ""] } } },
        {
          $group: {
            _id: "$shopifyProductId",
            n: { $sum: 1 },
            docs: {
              $push: {
                _id: "$_id",
                name: "$name",
                createdAt: "$createdAt",
                linxSku: "$linxSku",
                sourceHandle: "$sourceHandle",
                variants: { $size: { $ifNull: ["$variants", []] } },
                images: { $size: { $ifNull: ["$images", []] } },
              },
            },
          },
        },
        { $match: { n: { $gt: 1 } } },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  console.log(`${groups.length} Shopify product(s) claimed by more than one Mongo row`);
  if (!groups.length) {
    await conn.close();
    process.exit(0);
  }

  const doomed = [];
  let mismatched = 0;

  for (const group of groups) {
    const sorted = [...group.docs].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    );
    const keep = sorted[0];
    const drop = sorted.slice(1);

    // An echo is a copy of what we sent, so the names agree. Anything else is
    // two genuinely different products wrongly pointing at one Shopify product,
    // which is a linking mistake to look at by hand, not a duplicate to delete.
    const isEcho = drop.every(
      (d) => String(d.name).trim() === String(keep.name).trim(),
    );
    if (!isEcho) {
      mismatched += 1;
      console.log(
        `  ? ${group._id} — names differ, left alone: ${sorted.map((d) => `"${String(d.name).slice(0, 30)}"`).join(" vs ")}`,
      );
      continue;
    }
    // The echo is built from what Shopify knew, which is a subset of what we
    // sent. If a duplicate carries more than the row it came from, it has been
    // edited since and is not safe to delete unexamined.
    const richer = drop.filter(
      (d) => d.variants > keep.variants || d.images > keep.images || (d.linxSku && !keep.linxSku),
    );
    if (richer.length) {
      mismatched += 1;
      console.log(
        `  ? ${group._id} — "${String(keep.name).slice(0, 40)}": duplicate holds more data than the original, left alone`,
      );
      continue;
    }

    doomed.push(...drop.map((d) => ({ ...d, shopifyProductId: group._id, keptId: keep._id })));
  }

  console.log(`${doomed.length} echo row(s) to remove, ${mismatched} group(s) left for review`);
  for (const d of doomed.slice(0, 5)) {
    console.log(`  - ${d._id} "${String(d.name).slice(0, 45)}" (keeping ${d.keptId})`);
  }
  if (doomed.length > 5) console.log(`  … and ${doomed.length - 5} more`);

  if (!APPLY) {
    console.log("\nDry run — set APPLY=1 to delete");
    await conn.close();
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollback = path.join(__dirname, "..", `rollback-shopify-echo-dedupe-${stamp}.json`);
  const full = await col
    .find({ _id: { $in: doomed.map((d) => d._id) } })
    .toArray();
  fs.writeFileSync(rollback, JSON.stringify(full, null, 2));
  console.log(`\nfull documents saved to ${rollback}`);

  const result = await col.deleteMany({ _id: { $in: doomed.map((d) => d._id) } });
  console.log(`deleted ${result.deletedCount} echo product(s)`);
  console.log("remaining products:", await col.countDocuments({}));

  await conn.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

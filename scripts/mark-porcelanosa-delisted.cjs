/**
 * Tidy a PORCELANOSA row whose colourway Porcelanosa has retired.
 *
 * These are products the Product Finder no longer lists under the stored name:
 * the range was renamed and our catalogue kept both spellings, so the old name
 * survives as a second row alongside the new one. There is nothing to re-pull —
 * the code on the row now belongs to the *renamed* product, which we already
 * carry separately, so pulling would put the same photographs on two rows.
 *
 * What is fixed is the duplicated gallery entry, and the row is marked so the
 * repair scripts leave it alone and a merchandiser can decide whether to retire
 * it here too.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/mark-porcelanosa-delisted.cjs
 *
 *   DRY=1   report only
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const DRY = process.env.DRY === "1";
const ROLLBACK = path.join(
  __dirname,
  "..",
  "rollback-porcelanosa-delisted-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json",
);

/** name pattern -> the product it was renamed to on the source */
const DELISTED = [
  {
    match: /METROPOLITAN DECO MOSS/i,
    renamedTo: "METROPOLITAN DECO GRASS 20X20X0,85CM",
  },
];

function assetKey(url) {
  let b = String(url || "").split("?")[0].split("/").pop() || "";
  b = b.replace(/\.(jpe?g|png|webp|gif)$/i, "");
  b = b.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "");
  b = b.replace(/_\d{3}$/, "");
  return b.toUpperCase();
}

async function main() {
  const { register } = require("tsx/cjs/api");
  register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { reconcileProductMedia } = require("../src/lib/shopify/sync-media.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const products = db.collection("products");
  const bid = new mongoose.Types.ObjectId("6a6b9647d17a2adf5d0d2b35");
  const rollback = [];

  for (const entry of DELISTED) {
    const d = await products.findOne(
      { brand: bid, name: entry.match },
      { projection: { name: 1, images: 1, shopifyImages: 1, shopifyProductId: 1, specs: 1 } },
    );
    if (!d) {
      console.log("not found: " + entry.match);
      continue;
    }

    const seen = new Set();
    const deduped = [];
    for (const u of d.images || []) {
      const k = assetKey(u);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      deduped.push(u);
    }

    console.log(
      d.name + ": " + (d.images || []).length + " -> " + deduped.length +
        " image(s); renamed on the source to " + entry.renamedTo,
    );
    if (DRY) continue;

    rollback.push({
      id: String(d._id),
      name: d.name,
      images: d.images || [],
      shopifyImages: d.shopifyImages || [],
    });

    await products.updateOne(
      { _id: d._id },
      {
        $set: {
          images: deduped,
          "specs.sourceStatus": "delisted",
          "specs.sourceNote":
            "Porcelanosa renamed this colourway to " + entry.renamedTo +
            ", which this catalogue already carries as its own product. Code " +
            (d.specs && d.specs.porcelanosaCode) +
            " now resolves to that product, so this row is not re-pulled from the source.",
          "specs.imagesRefreshedAt": new Date().toISOString(),
          updatedAt: new Date(),
        },
      },
    );

    if (d.shopifyProductId) {
      const { links, uploaded, deleted } = await reconcileProductMedia(
        d.shopifyProductId,
        deduped,
        d.shopifyImages || [],
      );
      await products.updateOne(
        { _id: d._id },
        { $set: { shopifyImages: links, shopifySyncedAt: new Date(), shopifySyncError: "" } },
      );
      console.log("  shopify: +" + uploaded + " / -" + deleted);
    }
  }

  if (!DRY && rollback.length) {
    fs.writeFileSync(ROLLBACK, JSON.stringify(rollback, null, 2));
    console.log("rollback -> " + ROLLBACK);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

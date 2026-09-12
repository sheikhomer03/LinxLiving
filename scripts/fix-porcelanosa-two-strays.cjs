/**
 * The two PORCELANOSA products neither anchor could resolve, settled by hand.
 *
 * "Nova Special" — the Product Finder shifted this corner of the catalogue by
 * one *and* moved the page URL's code onto an unrelated article, so both
 * anchors failed. Matched instead on the fixed spec: 9X44,3CM in the NOVA
 * family is `ZOC. NOVA L 9X44,3CM`, code 100779. Its gallery already holds
 * exactly what 100779 serves, so only the stale code is corrected.
 *
 * "Metropolitan Deco Ocean" — Porcelanosa retired this colourway. The range now
 * runs GRASS/SEAGREEN/SNOW/STEEL, and a scan of 100640-100700 finds no current
 * article using asset 100344308. The photo on the product is therefore its own,
 * genuine and still served; what is wrong is only that the gallery holds it
 * twice, and that code 100664 now belongs to Deco Seagreen — which the DB
 * already carries as its own product. The duplicate is dropped and the row is
 * marked delisted so nobody re-points it at Seagreen's photographs.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-porcelanosa-two-strays.cjs
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
const NOVA_SPECIAL = "6a6b99b83ba7ddb2d4fffb66";
const ROLLBACK = path.join(
  __dirname,
  "..",
  "rollback-porcelanosa-strays-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json",
);

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

  // --- 1. Nova Special: stale code only -----------------------------------
  const nova = await products.findOne(
    { _id: new mongoose.Types.ObjectId(NOVA_SPECIAL) },
    { projection: { name: 1, images: 1, specs: 1 } },
  );
  if (!nova) throw new Error("Nova Special not found");
  console.log(
    "Nova Special: code " + nova.specs.porcelanosaCode + " -> 100779 (ZOC. NOVA L 9X44,3CM)",
  );
  console.log("  gallery unchanged: " + (nova.images || []).map((u) => u.split("/").pop()).join(", "));
  if (!DRY) {
    rollback.push({
      id: NOVA_SPECIAL,
      name: nova.name,
      images: nova.images || [],
      porcelanosaCode: nova.specs.porcelanosaCode,
    });
    await products.updateOne(
      { _id: nova._id },
      {
        $set: {
          "specs.porcelanosaCode": "100779",
          "specs.sku": "100779",
          "specs.productCode": "100779",
          "specs.sourceNote": "Matched on size 9X44,3CM in the NOVA family; the Product Finder page URL points at an unrelated article.",
          updatedAt: new Date(),
        },
      },
    );
  }

  // --- 2. Metropolitan Deco Ocean: dedupe, mark delisted -------------------
  const ocean = await products.findOne(
    { brand: bid, name: /METROPOLITAN DECO OCEAN/i },
    { projection: { name: 1, images: 1, shopifyImages: 1, shopifyProductId: 1, specs: 1 } },
  );
  if (!ocean) throw new Error("Metropolitan Deco Ocean not found");

  const seen = new Set();
  const deduped = [];
  for (const u of ocean.images || []) {
    const k = assetKey(u);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    deduped.push(u);
  }
  console.log(
    "\nMetropolitan Deco Ocean: " + (ocean.images || []).length + " -> " + deduped.length + " image(s)",
  );
  console.log("  keeping: " + deduped.map((u) => u.split("/").pop()).join(", ") + "  (delisted by Porcelanosa)");

  if (!DRY) {
    rollback.push({
      id: String(ocean._id),
      name: ocean.name,
      images: ocean.images || [],
      shopifyImages: ocean.shopifyImages || [],
      porcelanosaCode: ocean.specs.porcelanosaCode,
    });
    await products.updateOne(
      { _id: ocean._id },
      {
        $set: {
          images: deduped,
          "specs.sourceStatus": "delisted",
          "specs.sourceNote":
            "Retired by Porcelanosa; the Deco range now runs GRASS/SEAGREEN/SNOW/STEEL. Code 100664 now belongs to Deco Seagreen, which is a separate product here. The stored photograph is this colourway's own and is still served.",
          "specs.imagesRefreshedAt": new Date().toISOString(),
          updatedAt: new Date(),
        },
      },
    );
    if (ocean.shopifyProductId) {
      const { links, uploaded, deleted } = await reconcileProductMedia(
        ocean.shopifyProductId,
        deduped,
        ocean.shopifyImages || [],
      );
      await products.updateOne(
        { _id: ocean._id },
        { $set: { shopifyImages: links, shopifySyncedAt: new Date(), shopifySyncError: "" } },
      );
      console.log("  shopify: +" + uploaded + " / -" + deleted);
    }
    fs.writeFileSync(ROLLBACK, JSON.stringify(rollback, null, 2));
    console.log("\nrollback -> " + ROLLBACK);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

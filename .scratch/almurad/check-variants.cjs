const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "../../", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { applyDns } = require("../../scripts/mongo-connect.cjs");
applyDns();

async function run() {
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 20000 }).asPromise();
  const pCol = conn.db.collection("products");

  const withVariantsCount = await pCol.countDocuments({
    brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a"),
    "variants.0": { $exists: true }
  });
  console.log("PRODUCTS WITH VARIANTS COUNT:", withVariantsCount);

  const withVariants = await pCol.find({
    brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a"),
    "variants.0": { $exists: true }
  }).limit(3).toArray();

  for (const p of withVariants) {
    console.log("--- PRODUCT WITH VARIANTS ---");
    console.log({
      _id: p._id,
      name: p.name,
      sourceUrl: p.sourceUrl,
      sourceProductId: p.sourceProductId,
      sourceSku: p.sourceSku,
      stock: p.stock,
      shopifyProductId: p.shopifyProductId,
      variantsCount: p.variants.length,
      variants: p.variants.map(v => ({
        sku: v.sku,
        externalId: v.externalId,
        sourceUrl: v.sourceUrl,
        available: v.available,
        stock: v.stock,
        shopifyVariantId: v.shopifyVariantId,
        shopifyInventoryItemId: v.shopifyInventoryItemId
      }))
    });
  }

  const withoutVariantsCount = await pCol.countDocuments({
    brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a"),
    $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }]
  });
  console.log("PRODUCTS WITHOUT VARIANTS COUNT:", withoutVariantsCount);

  await conn.close();
}

run().catch(console.error);

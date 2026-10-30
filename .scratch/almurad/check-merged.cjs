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

  // Sample a product with variants
  const p = await pCol.findOne({
    brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a"),
    "variants.0": { $exists: true }
  });

  console.log("Sample merged product:", p.name, "variants:", p.variants.length);
  const skus = p.variants.map(v => v.sku);
  console.log("Variant SKUs:", skus);

  // Check if each variant SKU exists as a standalone product
  for (const s of skus) {
    const standalone = await pCol.findOne({
      brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a"),
      $or: [{ supplierSku: s }, { sourceSku: s }, { productCode: s }]
    });
    console.log(`SKU ${s} found as standalone product?`, standalone ? `YES: id=${standalone._id} name=${standalone.name} sourceUrl=${standalone.sourceUrl}` : "NO");
  }

  await conn.close();
}

run().catch(console.error);

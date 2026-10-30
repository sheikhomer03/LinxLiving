const path = require("path");
const fs = require("fs");
const readline = require("readline");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "../../", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { applyDns } = require("../../scripts/mongo-connect.cjs");
applyDns();

async function run() {
  const rl = readline.createInterface({ input: fs.createReadStream(".scratch/almurad/am-pdp.jsonl") });
  const skuToUrl = new Map();
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.sku && rec.sourceUrl) skuToUrl.set(String(rec.sku).trim(), rec.sourceUrl);
    } catch {}
  }

  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 20000 }).asPromise();
  const pCol = conn.db.collection("products");

  const brandId = new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a");
  const products = await pCol.find({ brand: brandId }, {
    projection: { _id: 1, name: 1, sourceUrl: 1, supplierSku: 1, sourceSku: 1, variants: 1 }
  }).toArray();

  console.log(`Found ${products.length} products in DB2.`);

  let productUrlFound = 0;
  let variantTotal = 0;
  let variantUrlFound = 0;
  const missingVariantSkus = [];

  for (const p of products) {
    if (p.sourceUrl) productUrlFound++;
    if (p.variants && p.variants.length > 0) {
      for (const v of p.variants) {
        variantTotal++;
        const sku = String(v.sku || "").trim();
        if (skuToUrl.has(sku)) {
          variantUrlFound++;
        } else if (p.sourceUrl) {
          // If variant has same SKU as product or no extra SKU
          missingVariantSkus.push({ productId: p._id, sku, parentUrl: p.sourceUrl });
        }
      }
    }
  }

  console.log(`Product sourceUrl coverage: ${productUrlFound} / ${products.length} (${(productUrlFound / products.length * 100).toFixed(1)}%)`);
  console.log(`Variant URL coverage from SKU map: ${variantUrlFound} / ${variantTotal} (${(variantUrlFound / variantTotal * 100).toFixed(1)}%)`);
  console.log(`Missing variant SKUs count: ${missingVariantSkus.length}`);
  if (missingVariantSkus.length > 0) {
    console.log("Sample missing variant SKUs:", missingVariantSkus.slice(0, 5));
  }

  await conn.close();
}

run().catch(console.error);

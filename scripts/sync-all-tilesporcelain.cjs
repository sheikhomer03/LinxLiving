require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({ "specs.Brand": "Tilesporcelain" }).toArray();
  console.log(`Syncing ${products.length} products to Shopify...`);
  
  let success = 0;
  let failed = 0;
  for (const p of products) {
    try {
      await syncFullProductToShopify(p, "Tiles Porcelain");
      success++;
    } catch (e) {
      console.error(`Failed ${p._id}: ${e.message}`);
      failed++;
    }
    if (success % 10 === 0) process.stdout.write(".");
  }
  console.log(`\nFinished! Success: ${success}, Failed: ${failed}`);
  process.exit(0);
}
main().catch(console.error);

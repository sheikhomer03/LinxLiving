require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  // Use dynamic import for the TS module
  const { pushUnsyncedProducts } = await import("../src/lib/shopify/sync-product.ts"); 
  
  for (let i = 0; i < 300; i++) {
    console.log(`Sync pass ${i + 1}...`);
    const res = await pushUnsyncedProducts(10);
    console.log("Result:", res);
    if (res.pushed === 0 && res.updated === 0 && res.created === 0) break;
  }
}
run().catch(console.error);

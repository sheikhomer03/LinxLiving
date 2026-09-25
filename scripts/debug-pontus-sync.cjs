require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db.collection("products").findOne({ _id: new (require("mongoose").Types.ObjectId)("6ab6178f3425de2945146087") });
  if (p) {
    console.log("Images array in DB:", p.images);
    console.log("ShopifyImages array in DB before:", p.shopifyImages);
    await syncFullProductToShopify(p, "Tiles Porcelain");
    
    // Fetch it again to see what it saved
    const pAfter = await db.collection("products").findOne({ _id: p._id });
    console.log("ShopifyImages array in DB after:", pAfter.shopifyImages);
  }
  process.exit(0);
}
main().catch(console.error);

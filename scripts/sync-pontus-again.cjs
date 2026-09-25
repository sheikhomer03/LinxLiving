require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db.collection("products").findOne({ _id: new (require("mongoose").Types.ObjectId)("6ab6178f3425de2945146087") });
  
  await syncFullProductToShopify(p, "Tiles Porcelain");
  
  await db.collection("products").updateOne(
    { _id: p._id },
    { $set: { 
      shopifyImages: p.shopifyImages
    }}
  );
  console.log("Updated Pontus with processed Shopify URLs! Length:", p.shopifyImages.length);
  p.shopifyImages.forEach(img => console.log(img.shopifyUrl));
  process.exit(0);
}
main().catch(console.error);

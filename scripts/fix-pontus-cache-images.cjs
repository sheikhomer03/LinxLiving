require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db.collection("products").findOne({ _id: new (require("mongoose").Types.ObjectId)("6ab6178f3425de2945146087") });
  
  const html = require("child_process").execSync("curl -s https://tilesporcelain.co.uk/pontus-chrome-round-thermostatic-shower-pack").toString();
  const imgMatches = html.match(/"img":"([^"]+)"/g);
  
  if (imgMatches) {
    // Keep the cache folder! Do not replace it!
    const urls = [...new Set(imgMatches.map(m => m.replace(/"img":"([^"]+)"/, "$1").replace(/\\\//g, "/")))];
    console.log("Real cached URLs:", urls);
    
    p.images = urls;
    await syncFullProductToShopify(p, "Tiles Porcelain");
    
    await db.collection("products").updateOne(
      { _id: p._id },
      { $set: { 
        images: urls,
        shopifyImages: p.shopifyImages, 
        shopifyProductId: p.shopifyProductId, 
        shopifyVariantId: p.shopifyVariantId,
        variants: p.variants
      }}
    );
    console.log("Fixed Pontus with REAL images and saved to DB. Length:", p.shopifyImages.length);
  }
  process.exit(0);
}
main().catch(console.error);

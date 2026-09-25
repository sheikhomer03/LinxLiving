require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const categories = ["grout", "glitter-grout", "tile-adhesive", "sealing-and-cleaning", "tiling-preparation", "tiling-tools"];
  const products = await db.collection("products").find({ 
    "specs.Brand": "Tilesporcelain", 
    category: { $in: categories } 
  }).toArray();
  
  console.log(`Checking ${products.length} accessories...`);
  
  let fixed = 0;
  for (const p of products) {
    try {
      const res = await fetch(p.sourceUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "text/html"
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      
      const match = html.match(/"price"\s*:\s*"([0-9.]+)"/);
      if (match) {
        const trueIncVat = parseFloat(match[1]);
        if (Math.abs(p.price - trueIncVat) > 0.05) {
          console.log(`Fixing ${p.name}: ${p.price} -> ${trueIncVat}`);
          await db.collection("products").updateOne(
            { _id: p._id },
            { $set: { price: trueIncVat } }
          );
          p.price = trueIncVat;
          await syncFullProductToShopify(p, "Tiles Porcelain");
          fixed++;
        }
      }
    } catch (e) {
      console.error(e);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`Fixed ${fixed} accessories and pushed to Shopify!`);
  process.exit(0);
}
main().catch(console.error);

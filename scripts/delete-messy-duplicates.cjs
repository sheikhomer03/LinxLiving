require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({ "specs.Brand": "Tilesporcelain", sourceUrl: /catalog\/product\/view/ }).toArray();
  
  console.log(`Deleting ${products.length} messy duplicate products...`);
  
  for (const p of products) {
    console.log(`Deleting ${p.name} (${p.sourceUrl})`);
    
    // 1. Delete from Shopify if it exists
    if (p.shopifyProductId) {
      try {
        await shopifyAdminRequest(`
          mutation productDelete($input: ProductDeleteInput!) {
            productDelete(input: $input) {
              deletedProductId
              userErrors { field message }
            }
          }
        `, { input: { id: p.shopifyProductId } });
        console.log(` - Deleted from Shopify`);
      } catch (e) {
        console.error(` - Failed to delete from Shopify:`, e.message);
      }
    }
    
    // 2. Delete from MongoDB
    await db.collection("products").deleteOne({ _id: p._id });
    console.log(` - Deleted from MongoDB`);
  }
  
  console.log("Done!");
  process.exit(0);
}
main().catch(console.error);

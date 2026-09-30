const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  const products = await col.find({ brand: brand._id, shopifyImages: { $exists: false }, shopifyProductId: { $ne: null } }).toArray();
  console.log(`Found ${products.length} products to recreate`);
  
  let deletedCount = 0;
  for (const p of products) {
    if (p.shopifyProductId) {
      try {
        await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/api/2024-01/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN
          },
          body: JSON.stringify({
            query: `mutation { productDelete(input: { id: "${p.shopifyProductId}" }) { deletedProductId } }`
          })
        });
        await col.updateOne({ _id: p._id }, { $unset: { shopifyProductId: "", shopifyVariantId: "" } });
        deletedCount++;
      } catch (err) {
        console.log('Error deleting product', p._id);
      }
    }
  }
  
  console.log(`Done deleting ${deletedCount} products from Shopify and unsetting IDs`);
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

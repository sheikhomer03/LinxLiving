const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  
  const brands = await db.collection('brands').find().toArray();
  for (const brand of brands) {
    const col = brand.dataCluster === 'secondary' ? conn.db.collection('products') : db.collection('products');
    
    // Check how many have shopifyImages but contain a bad URL (not cdn.shopify.com)
    const badShopifyUrls = await col.countDocuments({
      brand: brand._id,
      "shopifyImages.shopifyUrl": { $not: /cdn\.shopify\.com/ }
    });
    
    const missingShopifyImages = await col.countDocuments({
      brand: brand._id,
      shopifyProductId: { $ne: null },
      $or: [{ shopifyImages: { $exists: false } }, { shopifyImages: { $size: 0 } }]
    });
    
    if (badShopifyUrls > 0 || missingShopifyImages > 0) {
      console.log(brand.name, '- Bad URLs:', badShopifyUrls, '- Missing shopifyImages:', missingShopifyImages);
    }
  }
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

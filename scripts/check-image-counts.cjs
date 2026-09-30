const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  const products = await col.find({ brand: brand._id }).project({ images: 1, shopifyImages: 1, name: 1 }).toArray();
  let imgCounts = {};
  let shopifyImgCounts = {};
  for (const p of products) {
    const l = p.images?.length || 0;
    imgCounts[l] = (imgCounts[l] || 0) + 1;
    
    const sl = p.shopifyImages?.length || 0;
    shopifyImgCounts[sl] = (shopifyImgCounts[sl] || 0) + 1;
  }
  console.log('Images length distribution:', imgCounts);
  console.log('ShopifyImages length distribution:', shopifyImgCounts);
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

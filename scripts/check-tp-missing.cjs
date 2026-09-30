const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  
  const col = conn.db.collection('products');
  const countEmptyImages = await col.countDocuments({ brand: brand._id, $or: [{ images: { $exists: false } }, { images: { $size: 0 } }] });
  const countEmptyShopify = await col.countDocuments({ brand: brand._id, $or: [{ shopifyImages: { $exists: false } }, { shopifyImages: { $size: 0 } }] });
  const countNoShopifyUrl = await col.countDocuments({ brand: brand._id, "shopifyImages.shopifyUrl": "" });
  
  console.log('Total Empty Images:', countEmptyImages);
  console.log('Total Empty ShopifyImages:', countEmptyShopify);
  console.log('Total missing shopifyUrl in pairs:', countNoShopifyUrl);
  
  const sample = await col.findOne({ brand: brand._id, "shopifyImages.shopifyUrl": "" });
  if (sample) console.log('Sample missing shopifyUrl:', sample.name, sample.shopifyImages);
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

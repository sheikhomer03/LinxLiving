const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  const sample = await col.findOne({ name: 'Pontus Round Thermostatic Shower Pack', brand: brand._id });
  if (sample) {
    console.log('Images:', sample.images);
    console.log('ShopifyImages:', sample.shopifyImages);
  }
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

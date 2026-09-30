const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  const count = await col.countDocuments({ brand: brand._id, images: { $regex: 'tilesporcelain' } });
  console.log('Products with tilesporcelain in images array:', count);
  
  const sample = await col.findOne({ brand: brand._id, images: { $regex: 'tilesporcelain' } });
  if (sample) {
    console.log('Sample:', sample.name);
    console.log('Images:', sample.images);
  }
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

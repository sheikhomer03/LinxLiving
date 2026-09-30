const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  
  if (brand.dataCluster === 'secondary') {
    const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
    const p = await conn.db.collection('products').findOne({ brand: brand._id });
    console.log('Product on Secondary:', p.name);
    console.log('images length:', p.images?.length);
    if (p.images) console.log('images[0]:', p.images[0]);
    console.log('shopifyImages length:', p.shopifyImages?.length);
    if (p.shopifyImages) console.log('shopifyImages[0]:', p.shopifyImages[0]);
    await conn.close();
  } else {
    const p = await db.collection('products').findOne({ brand: brand._id });
    console.log('Product on Primary:', p.name);
  }
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

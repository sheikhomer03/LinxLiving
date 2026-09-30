const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  
  for (const name of ['Total Tiles', 'Walls and Floors']) {
    const brand = await db.collection('brands').findOne({ name });
    if (!brand) { console.log(name, 'not found'); continue; }
    
    const col = brand.dataCluster === 'secondary' ? conn.db.collection('products') : db.collection('products');
    const total = await col.countDocuments({ brand: brand._id });
    const countEmptyShopify = await col.countDocuments({ brand: brand._id, $or: [{ shopifyImages: { $exists: false } }, { shopifyImages: { $size: 0 } }] });
    
    console.log(name, 'total:', total, 'empty shopifyImages:', countEmptyShopify);
  }
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

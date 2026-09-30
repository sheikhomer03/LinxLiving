const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');
const { execSync } = require('child_process');

async function run() {
  const { db } = await connectMongo();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const col = conn.db.collection('products');
  
  console.log('Restoring source URLs for Tiles Porcelain...');
  const products = await col.find({ brand: brand._id, shopifyImages: { $exists: true, $not: { $size: 0 } } }).toArray();
  
  let ops = [];
  for (const p of products) {
    if (!p.shopifyImages || p.shopifyImages.length === 0) continue;
    const restoredImages = p.shopifyImages.map(si => si.sourceUrl);
    ops.push({
      updateOne: {
        filter: { _id: p._id },
        update: { 
          $set: { images: restoredImages },
          $unset: { shopifyImages: "" }
        }
      }
    });
  }
  
  if (ops.length > 0) {
    await col.bulkWrite(ops);
    console.log('Restored', ops.length, 'products.');
  } else {
    console.log('No products needed restoring.');
  }
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

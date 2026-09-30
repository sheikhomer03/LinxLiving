const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');
async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const products = await conn.db.collection('products').find({ brand: brand._id, images: { $size: 1 } }).limit(5).toArray();
  for (const p of products) {
    console.log(p.sourceUrl);
  }
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

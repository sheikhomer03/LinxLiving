const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');
async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const p = await conn.db.collection('products').findOne({ brand: brand._id, images: { $size: 1 } });
  console.log(p.sourceUrl);
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

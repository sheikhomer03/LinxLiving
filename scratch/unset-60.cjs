const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  const res = await col.updateMany(
    { brand: brand._id, shopifyImages: { $exists: false }, shopifyProductId: { $ne: null } },
    { $unset: { shopifyProductId: "", shopifyVariantId: "" } }
  );
  console.log(`Unset IDs for ${res.modifiedCount} products`);
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

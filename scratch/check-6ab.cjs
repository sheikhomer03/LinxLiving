const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const col = conn.db.collection('products');
  
  const p = await col.findOne({ _id: new mongoose.Types.ObjectId("6ab6178f3425de2945146096") });
  console.log("Name:", p.name);
  console.log("Original Images:", p.images.length);
  console.log("Shopify Images:", p.shopifyImages?.length);
  console.log("First Shopify Image:", p.shopifyImages?.[0]);
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

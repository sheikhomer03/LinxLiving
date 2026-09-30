const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  const p = await col.findOne({ brand: brand._id });
  console.log("Product:", p.name, "Stock:", p.stock);
  
  const zeros = await col.countDocuments({ brand: brand._id, stock: 0 });
  const nonZeros = await col.countDocuments({ brand: brand._id, stock: { $gt: 0 } });
  
  console.log(`Zeros: ${zeros}, NonZeros: ${nonZeros}`);
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

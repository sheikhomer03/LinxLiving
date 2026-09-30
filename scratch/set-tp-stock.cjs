const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  const OPTION_ARRAYS = ["variants", "bases", "shades", "typeOptions"];
  
  const products = await col.find({ brand: brand._id }).toArray();
  let updatedCount = 0;
  
  for (const p of products) {
    const set = { stock: 500, isOutOfStock: false, stockStatus: "in_stock" };
    
    for (const key of OPTION_ARRAYS) {
      if (Array.isArray(p[key])) {
        set[key] = p[key].map(v => ({ ...v, stock: 500 }));
      }
    }
    
    await col.updateOne({ _id: p._id }, { $set: set });
    updatedCount++;
  }
  
  console.log(`Updated stock to 500 for ${updatedCount} Tiles Porcelain products in MongoDB.`);
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

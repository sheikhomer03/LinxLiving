const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const p = await conn.db.collection('products').findOne({ _id: new mongoose.Types.ObjectId("6ab6178f3425de2945146096") });
  console.log('Source URL:', p.sourceUrl);
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  // Just focus on the specific product first to test!
  const p = await col.findOne({ _id: new mongoose.Types.ObjectId("6ab6178f3425de2945146096") });
  if (!p) { console.log('Product not found'); process.exit(1); }
  
  const res = await fetch(p.sourceUrl);
  const html = await res.text();
  
  const match = html.match(/"data":\s*(\[.*?\])/);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      const fullImages = data.map(img => img.full).filter(Boolean);
      console.log('Found gallery images:', fullImages);
    } catch(e) {
      console.log('Failed to parse JSON', e);
    }
  } else {
    console.log('No gallery data found');
  }
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');
async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db2.collection('products').findOne({ 'specs.source': 'aica-scrape' });
  console.log('Product price:', p.price);
  if (p.variants) console.log('Variant prices:', p.variants.map(v => v.price));
  process.exit();
}
run();

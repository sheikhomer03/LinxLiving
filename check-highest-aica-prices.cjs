require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');
async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db2.collection('products').find({ 'specs.source': 'aica-scrape' }).sort({ price: -1 }).limit(1).toArray();
  console.log('Highest Product price:', p[0].price);
  if (p[0].variants) console.log('Variant prices:', p[0].variants.map(v => v.price));
  process.exit();
}
run();

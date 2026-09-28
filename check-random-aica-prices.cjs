require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');
async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db2.collection('products').find({ 'specs.source': 'aica-scrape' }).limit(3).toArray();
  for (const prod of p) {
    console.log(prod.sourceUrl);
    console.log(prod.variants.slice(0,2).map(v => v.name + ' - ' + v.price));
  }
  process.exit();
}
run();

require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');
async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db2.collection('products').findOne({ sourceUrl: { $regex: 'cib' }, 'specs.source': 'aica-scrape' });
  console.log('compareAtPrice:', p.compareAtPrice);
  console.log('salePercent:', p.specs?.salePercent);
  console.log('salePriceMode:', p.specs?.salePriceMode);
  console.log('variants:', p.variants.map(v => v.name + ' - avail: ' + v.available + ' - compare: ' + v.compareAtPrice));
  process.exit();
}
run();

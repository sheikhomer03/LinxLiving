require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');
async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db2.collection('products').findOne({ price: { $gt: 1000 }, 'specs.source': 'aica-scrape' });
  if (p) {
    console.log('Found product with price > 1000:', p.price);
  } else {
    console.log('No product with price > 1000 found!');
  }
  process.exit();
}
run();

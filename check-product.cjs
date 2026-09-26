require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');
async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  const brand = await db.collection('brands').findOne({ name: 'Aica Bathrooms' });
  const p = await db2.collection('products').findOne({ brand: brand._id, $expr: { $gt: [{ $size: "$variants" }, 1] } });
  console.log(JSON.stringify(p, null, 2));
  process.exit();
}
run();

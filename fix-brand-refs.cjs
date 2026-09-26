const { connectMongo } = require('./scripts/mongo-connect.cjs');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const { db: db1, mongoose } = await connectMongo(); // URI 1
  const brand1 = await db1.collection('brands').findOne({ name: "Aica Bathrooms" });
  console.log("Brand 1 ID:", brand1._id);

  const client2 = new MongoClient(process.env.MONGODB_URL2);
  await client2.connect();
  const db2 = client2.db();
  
  const brand2 = await db2.collection('brands').findOne({ name: "Aica Bathrooms" });
  console.log("Brand 2 ID:", brand2._id);

  const res = await db2.collection('products').updateMany(
    { "specs.source": "aica-scrape" },
    { $set: { brand: brand1._id, brands: [brand1._id] } }
  );
  console.log(`Updated ${res.modifiedCount} products in DB2 with Brand 1 ID`);
  
  await client2.close();
  await mongoose.disconnect();
}
run().catch(console.error);

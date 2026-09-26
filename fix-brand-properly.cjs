require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');

async function run() {
  const { db, mongoose } = await connectMongo();
  await db.collection('brands').updateOne(
    { name: "Aica Bathrooms" },
    { $set: { name: "Aica Bathrooms", dataCluster: "secondary", isActive: true, createdAt: new Date() } },
    { upsert: true }
  );
  console.log("Brand created in primary DB (MONGODB_URI)");
  await mongoose.disconnect();
}
run().catch(console.error);

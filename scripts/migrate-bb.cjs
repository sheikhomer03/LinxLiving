require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const sourceClient = new MongoClient(process.env.MONGODB_URL2);
  const targetClient = new MongoClient(process.env.MONGODB_URI);
  
  await sourceClient.connect();
  await targetClient.connect();
  
  const sourceDb = sourceClient.db();
  const targetDb = targetClient.db();
  
  const docs = await sourceDb.collection("products").find({ sourceUrl: { $regex: "betterbathrooms" } }).toArray();
  console.log(`Found ${docs.length} Better Bathrooms products in MONGODB_URL2`);
  
  let inserted = 0;
  for (const doc of docs) {
    // Upsert by sourceUrl
    const res = await targetDb.collection("products").updateOne(
      { sourceUrl: doc.sourceUrl },
      { $set: { ...doc, updatedAt: new Date() } },
      { upsert: true }
    );
    if (res.upsertedCount > 0 || res.modifiedCount > 0) inserted++;
    if (inserted % 100 === 0) console.log(`Migrated ${inserted}...`);
  }
  
  console.log(`Successfully migrated ${inserted} Better Bathrooms products to MONGODB_URI`);
  
  await sourceClient.close();
  await targetClient.close();
}
run().catch(console.error);

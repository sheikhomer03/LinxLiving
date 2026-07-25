/**
 * Update storeName in Settings to "Linx Square".
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/update-store-name.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const settings = db.collection("settings");

  const result = await settings.updateOne(
    {},
    { $set: { storeName: "Linx Square" } },
    { upsert: true },
  );

  const doc = await settings.findOne({});
  console.log("Updated:", result.modifiedCount || result.upsertedCount);
  console.log("storeName:", doc?.storeName);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

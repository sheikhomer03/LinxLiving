/**
 * Create TransferNow brand (isolated — does not touch other brands).
 *   node --require ./scripts/mongo-dns.cjs scripts/seed-transfernow-brand.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");
const mongoose = require("mongoose");

const BRAND_NAME = "TransferNow";
const BRAND_SLUG = "transfernow";

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const brands = mongoose.connection.db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const r = await brands.insertOne({
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 70,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    });
    brand = { _id: r.insertedId, name: BRAND_NAME, slug: BRAND_SLUG };
    console.log(`Created brand ${BRAND_NAME} (${brand._id})`);
  } else {
    await brands.updateOne(
      { _id: brand._id },
      { $set: { name: BRAND_NAME, isActive: true, updatedAt: now } },
    );
    console.log(`Brand already exists: ${brand.name} (${brand._id})`);
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

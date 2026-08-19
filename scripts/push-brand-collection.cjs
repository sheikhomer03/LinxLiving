/**
 * Push one brand to Shopify as its collection, and record the GID.
 *
 * Every other brand in the catalogue has a `brand-<slug>` collection in Shopify
 * — that is how the storefront and the shop agree on what a brand contains. A
 * brand created by an importer rather than through the admin has no collection
 * until something pushes it, and the admin's own catch-up job only runs while
 * the app is up.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/push-brand-collection.cjs "RAK CERAMICS"
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const TARGET = String(process.argv[2] || "").trim();

async function main() {
  if (!TARGET) throw new Error('Name a brand: … push-brand-collection.cjs "RAK CERAMICS"');

  const { register } = require("tsx/cjs/api");
  register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { pushBrandAsCollection } = require("../src/lib/shopify/sync-collection.ts");

  const conn = await connectMongo();
  const brands = conn.db.collection("brands");
  const brand = await brands.findOne({
    $or: [
      { name: TARGET },
      { slug: TARGET.toLowerCase().replace(/[^a-z0-9]+/g, "-") },
    ],
  });
  if (!brand) throw new Error(`No brand named "${TARGET}"`);

  console.log(`${brand.name} (${brand.slug}) — existing: ${brand.shopifyCollectionId || "none"}`);
  const shopifyId = await pushBrandAsCollection({
    name: brand.name,
    slug: brand.slug,
    image: brand.image || undefined,
    shopifyCollectionId: brand.shopifyCollectionId || undefined,
  });

  await brands.updateOne(
    { _id: brand._id },
    {
      $set: {
        shopifyCollectionId: shopifyId,
        shopifySyncError: null,
        shopifySyncedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
  console.log(`collection: ${shopifyId}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

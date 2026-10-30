const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "../../", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("../../scripts/mongo-connect.cjs");

async function run() {
  const conn1 = await connectMongo(process.env.MONGODB_URI);
  const primaryDb = conn1.db;
  const brandsCol = primaryDb.collection("brands");
  const brand = await brandsCol.findOne({ name: /al\s*murad/i });
  console.log("BRAND:", JSON.stringify({
    _id: brand._id,
    name: brand.name,
    slug: brand.slug,
    isActive: brand.isActive,
    dataCluster: brand.dataCluster,
    shopifyCollectionId: brand.shopifyCollectionId
  }, null, 2));

  if (!brand) {
    console.log("Brand not found in DB1");
    process.exit(0);
  }

  const pCol1 = primaryDb.collection("products");
  const count1 = await pCol1.countDocuments({ brand: brand._id });
  console.log(`Products in DB1: ${count1}`);

  let secConn = null;
  let count2 = 0;
  let targetCol = pCol1;

  if (process.env.MONGODB_URL2) {
    secConn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 }).asPromise();
    const pCol2 = secConn.db.collection("products");
    count2 = await pCol2.countDocuments({ brand: brand._id });
    console.log(`Products in DB2: ${count2}`);
    if (brand.dataCluster === "secondary") {
      targetCol = pCol2;
    }
  }

  const totalProducts = await targetCol.countDocuments({ brand: brand._id });
  console.log(`Total Products in active cluster (${brand.dataCluster || 'primary'}): ${totalProducts}`);

  const sample = await targetCol.findOne({ brand: brand._id });
  if (sample) {
    console.log("SAMPLE PRODUCT INFO:", {
      _id: sample._id,
      name: sample.name,
      sourceUrl: sample.sourceUrl,
      sourceProductId: sample.sourceProductId,
      sourceSku: sample.sourceSku,
      stock: sample.stock,
      isOutOfStock: sample.isOutOfStock,
      stockStatus: sample.stockStatus,
      shopifyProductId: sample.shopifyProductId,
      variantsCount: sample.variants ? sample.variants.length : 0,
      variantsSample: sample.variants && sample.variants.length > 0 ? sample.variants[0] : null,
    });
  }

  // Stock distribution
  const stockDist = await targetCol.aggregate([
    { $match: { brand: brand._id } },
    { $group: { _id: { stock: "$stock", stockStatus: "$stockStatus", isOutOfStock: "$isOutOfStock" }, count: { $sum: 1 } } }
  ]).toArray();
  console.log("STOCK DISTRIBUTION:", JSON.stringify(stockDist, null, 2));

  // Shopify IDs count
  const shopifyProductCount = await targetCol.countDocuments({ brand: brand._id, shopifyProductId: { $exists: true, $ne: null, $ne: "" } });
  console.log(`Products with shopifyProductId: ${shopifyProductCount}`);

  // Check how many have variants and what fields variants have
  const variantStats = await targetCol.aggregate([
    { $match: { brand: brand._id } },
    { $unwind: { path: "$variants", preserveNullAndEmptyArrays: true } },
    { $group: {
        _id: null,
        totalProducts: { $addToSet: "$_id" },
        totalVariants: { $sum: { $cond: [{ $ifNull: ["$variants", false] }, 1, 0] } },
        variantsWithShopifyVariantId: {
          $sum: { $cond: [{ $and: ["$variants.shopifyVariantId", { $ne: ["$variants.shopifyVariantId", ""] }] }, 1, 0] }
        },
        variantsWithInventoryItemId: {
          $sum: { $cond: [{ $and: ["$variants.shopifyInventoryItemId", { $ne: ["$variants.shopifyInventoryItemId", ""] }] }, 1, 0] }
        },
        variantsAvailableTrue: {
          $sum: { $cond: [{ $eq: ["$variants.available", true] }, 1, 0] }
        },
        variantsAvailableFalse: {
          $sum: { $cond: [{ $eq: ["$variants.available", false] }, 1, 0] }
        }
      }
    },
    { $project: {
        totalProductsCount: { $size: "$totalProducts" },
        totalVariants: 1,
        variantsWithShopifyVariantId: 1,
        variantsWithInventoryItemId: 1,
        variantsAvailableTrue: 1,
        variantsAvailableFalse: 1
      }
    }
  ]).toArray();
  console.log("VARIANT STATS:", JSON.stringify(variantStats, null, 2));

  if (conn1) await conn1.close();
  if (secConn) await secConn.close();
}

run().catch(console.error);

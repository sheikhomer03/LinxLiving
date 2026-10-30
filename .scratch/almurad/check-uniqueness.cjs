const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "../../", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { applyDns } = require("../../scripts/mongo-connect.cjs");
applyDns();

async function run() {
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 20000 }).asPromise();
  const pCol = conn.db.collection("products");

  // Check product-level sourceProductId & sourceUrl coverage
  const total = await pCol.countDocuments({ brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a") });
  const withSourceId = await pCol.countDocuments({
    brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a"),
    sourceProductId: { $exists: true, $ne: "" }
  });
  const withSourceUrl = await pCol.countDocuments({
    brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a"),
    sourceUrl: { $exists: true, $ne: "" }
  });
  const withSku = await pCol.countDocuments({
    brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a"),
    supplierSku: { $exists: true, $ne: "" }
  });

  console.log(`Product coverage out of ${total}:`);
  console.log(`- sourceProductId: ${withSourceId}`);
  console.log(`- sourceUrl: ${withSourceUrl}`);
  console.log(`- supplierSku: ${withSku}`);

  // Check duplicate sourceProductId
  const dupSourceId = await pCol.aggregate([
    { $match: { brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a") } },
    { $group: { _id: "$sourceProductId", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  console.log(`Duplicate sourceProductId count: ${dupSourceId.length}`);

  // Check duplicate SKUs across all variants & products
  const dupSkus = await pCol.aggregate([
    { $match: { brand: new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a") } },
    { $project: {
        skus: {
          $concatArrays: [
            [{ $ifNull: ["$supplierSku", "$sourceSku"] }],
            { $map: { input: { $ifNull: ["$variants", []] }, as: "v", in: "$$v.sku" } }
          ]
        }
      }
    },
    { $unwind: "$skus" },
    { $match: { skus: { $ne: null, $ne: "" } } },
    { $group: { _id: "$skus", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  console.log(`Duplicate SKUs count: ${dupSkus.length}`);

  await conn.close();
}

run().catch(console.error);

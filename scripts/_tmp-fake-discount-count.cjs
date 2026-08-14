const { connectMongo } = require("./mongo-connect.cjs");
(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const fake = await db.collection("products").countDocuments({ "specs.salePriceMode": "raise-was-keep-price" });
  const totalOnSale = await db.collection("products").countDocuments({ "specs.salePercent": { $gt: 0 } });
  const total = await db.collection("products").countDocuments({});
  console.log({ fakeDiscountCount: fake, totalWithSalePercent: totalOnSale, totalProducts: total });
  const sample = await db.collection("products").find({ "specs.salePriceMode": "raise-was-keep-price" }).limit(5).project({ name:1, price:1, "specs.compareAtPrice":1, "specs.shopifyCompareAt":1, "specs.salePercent":1, "specs.saleAppliedAt":1 }).toArray();
  console.log(JSON.stringify(sample, null, 1));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});

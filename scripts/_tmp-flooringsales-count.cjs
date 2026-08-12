const { connectMongo } = require("./mongo-connect.cjs");
(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ name: /flooring sales/i });
  const total = await db.collection("products").countDocuments({ brand: brand._id });
  const onSaleTrue = await db.collection("products").countDocuments({ brand: brand._id, "specs.onSale": true });
  const regGtPrice = await db.collection("products").countDocuments({ brand: brand._id, $expr: { $gt: ["$specs.regularPrice", "$price"] } });
  console.log({ total, onSaleTrue, regGtPrice });
  const samples = await db.collection("products").find({ brand: brand._id, "specs.onSale": true }).limit(3).project({ name:1, price:1, "specs.regularPrice":1, "specs.onSale":1 }).toArray();
  console.log(JSON.stringify(samples, null, 1));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});

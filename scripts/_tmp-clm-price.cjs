const { connectMongo } = require("./mongo-connect.cjs");
(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const prods = await db.collection("products").find({ name: /CLM580[12]/i }).project({
    name:1, price:1, tradePrice:1, specs:1, badges:1
  }).toArray();
  prods.forEach(p => console.log(JSON.stringify(p, null, 1)));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});

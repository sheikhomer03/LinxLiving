const { connectMongo } = require("./mongo-connect.cjs");
(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const prods = await db.collection("products").find({ name: /CLM\d{4}/i }).project({ name:1, department:1, category:1, brand:1 }).toArray();
  console.log("total CLM products:", prods.length);
  const deptCounts = {};
  prods.forEach(p => { deptCounts[p.department||"(blank)"] = (deptCounts[p.department||"(blank)"]||0)+1; });
  console.log(deptCounts);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});

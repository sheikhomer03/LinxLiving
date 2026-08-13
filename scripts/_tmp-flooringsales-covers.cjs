const { connectMongo } = require("./mongo-connect.cjs");
const fs = require("fs");
(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ name: /flooring sales/i });
  const cursor = db.collection("products").find(
    { brand: brand._id, images: { $exists: true, $ne: [] } },
    { projection: { name: 1, images: 1, category: 1, subCategory: 1 } }
  );
  const out = [];
  for await (const p of cursor) {
    const img = (p.images || []).find(u => typeof u === "string" && /^https?:\/\//.test(u));
    if (!img) continue;
    out.push({ id: String(p._id), name: p.name, category: p.category||"", subCategory: p.subCategory||"", url: img });
  }
  fs.writeFileSync("/tmp/flooringsales-covers.json", JSON.stringify(out));
  console.log("wrote", out.length);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});

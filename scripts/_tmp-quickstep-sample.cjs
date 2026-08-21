const { connectMongo } = require("./mongo-connect.cjs");
(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brands = await db.collection("brands").find({ name: /quick.?step/i }).toArray();
  console.log("Brands matching:", brands.map(b => ({ id: String(b._id), name: b.name, slug: b.slug })));

  const byName = await db.collection("products").find({ name: /quick.?step/i }).limit(5).project({ name:1, images:1, department:1, category:1 }).toArray();
  console.log("\nProducts with 'quickstep' in name:", byName.length);
  byName.forEach(p => console.log(" -", p.name, "|", p.images?.[0]));

  if (brands.length) {
    const brandIds = brands.map(b => b._id);
    const count = await db.collection("products").countDocuments({ brand: { $in: brandIds } });
    console.log("\nProducts with Quickstep brand ref:", count);
    const sample = await db.collection("products").find({ brand: { $in: brandIds } }).limit(5).project({ name:1, images:1, department:1, category:1 }).toArray();
    sample.forEach(p => console.log(" -", p.name, "|", p.images?.[0]));
  }
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});

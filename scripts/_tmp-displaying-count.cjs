const { connectMongo } = require("./mongo-connect.cjs");
(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;

  const hiddenBrandRows = await db.collection("brands").find({
    $or: [{ isActive: false }, { slug: "britmet" }]
  }).project({ _id: 1, name: 1, slug: 1 }).toArray();
  console.log("Hidden brands:", hiddenBrandRows.map(b => b.name || b.slug));
  const hiddenIds = hiddenBrandRows.map(b => b._id);

  const filter = {
    category: { $exists: true, $nin: [null, ""] },
    price: { $gt: 0 },
    brand: { $nin: hiddenIds },
  };
  const count = await db.collection("products").countDocuments(filter);
  console.log("Displaying products (matches storefront filter):", count);

  // rough image count estimate
  const sample = await db.collection("products").find(filter).limit(2000).project({ images: 1 }).toArray();
  const avgImgs = sample.reduce((s,p) => s + (Array.isArray(p.images) ? p.images.filter(u=>typeof u==='string' && /^https?:\/\//.test(u)).length : 0), 0) / sample.length;
  console.log("avg valid images per product (sample of 2000):", avgImgs.toFixed(2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});

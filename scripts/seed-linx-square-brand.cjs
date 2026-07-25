/**
 * Seed default "Linx Square" brand and assign existing top-level menus.
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/seed-linx-square-brand.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brands = db.collection("brands");
  const menus = db.collection("menus");

  let brand = await brands.findOne({ slug: "linx-square" });
  if (!brand) {
    const result = await brands.insertOne({
      name: "Linx Square",
      slug: "linx-square",
      order: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    brand = await brands.findOne({ _id: result.insertedId });
    console.log("Created brand: Linx Square");
  } else {
    console.log("Brand already exists: Linx Square");
  }

  const brandId = brand._id;
  const topLevelMenus = await menus.find({ parent: null }).toArray();
  let assigned = 0;

  for (const menu of topLevelMenus) {
    if (!menu.brand) {
      await menus.updateOne(
        { _id: menu._id },
        { $set: { brand: brandId, updatedAt: new Date() } },
      );
      assigned += 1;
    }
  }

  console.log(`Assigned brand to ${assigned} top-level menu(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

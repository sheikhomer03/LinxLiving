const path = require("path");
const dns = require("dns");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db
    .collection("brands")
    .findOne({ slug: "fakro" }, { projection: { _id: 1, name: 1, slug: 1 } });
  if (!brand) {
    console.log("No fakro brand");
    process.exit(1);
  }
  const menus = await db.collection("menus").countDocuments({ brand: brand._id });
  const parents = await db
    .collection("menus")
    .countDocuments({ brand: brand._id, parent: null });
  const products = await db
    .collection("products")
    .countDocuments({ brand: brand._id });
  const withImgs = await db.collection("products").countDocuments({
    brand: brand._id,
    "images.0": { $exists: true },
  });
  const byCat = await db
    .collection("products")
    .aggregate([
      { $match: { brand: brand._id } },
      { $group: { _id: "$category", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  console.log(
    JSON.stringify(
      { brand: brand.slug, menus, parents, products, withImgs, byCat },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

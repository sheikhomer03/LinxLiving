/**
 * Seed Linx Trade category menus from the Britmet Dropbox folder names.
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/seed-linx-trade-categories.cjs
 */
const path = require("path");
const dns = require("dns");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");

const CATEGORIES = [
  { name: "Liteslate", order: 1 },
  { name: "Shingle", order: 2 },
  { name: "Slate 2000", order: 3 },
  { name: "Ultratile", order: 4 },
  { name: "Villatile", order: 5 },
  { name: "Profile 49", order: 6 },
  { name: "Plaintile", order: 7 },
  { name: "Pantile 2000", order: 8 },
  { name: "Door Canopies", order: 9 },
  { name: "Hornsey Steel Products", order: 10 },
];

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brands = db.collection("brands");
  const menus = db.collection("menus");

  let brand = await brands.findOne({ slug: "linx-trade" });
  if (!brand) {
    const now = new Date();
    const result = await brands.insertOne({
      name: "LINX TRADE",
      slug: "linx-trade",
      order: 3,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    });
    brand = await brands.findOne({ _id: result.insertedId });
    console.log("Created brand LINX TRADE");
  } else {
    console.log(`Brand: ${brand.name}`);
  }

  let created = 0;
  let updated = 0;

  for (const cat of CATEGORIES) {
    const slug = slugify(cat.name);
    const existing = await menus.findOne({ slug, parent: null });
    const now = new Date();
    if (!existing) {
      await menus.insertOne({
        name: cat.name,
        slug,
        parent: null,
        brand: brand._id,
        order: cat.order,
        isActive: true,
        image: "",
        createdAt: now,
        updatedAt: now,
      });
      console.log(`+ ${cat.name}`);
      created++;
    } else {
      await menus.updateOne(
        { _id: existing._id },
        {
          $set: {
            name: cat.name,
            brand: brand._id,
            order: cat.order,
            isActive: true,
            updatedAt: now,
          },
        },
      );
      console.log(`· ${cat.name} (linked to Linx Trade)`);
      updated++;
    }
  }

  console.log(`Done. created=${created} updated=${updated}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

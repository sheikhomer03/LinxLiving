/**
 * Wipe DB except Spectra Excel products + Finish menus.
 * Keeps admin users.
 *
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/wipe-keep-spectra.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const KEEP_MENU_SLUGS = [
  "gloss",
  "high-gloss",
  "matt",
  "matt-carving",
  "outdoor",
];

async function main() {
  const dry = process.argv.includes("--dry");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const menus = db.collection("menus");
  const products = db.collection("products");
  const orders = db.collection("orders");
  const users = db.collection("users");
  const queries = db.collection("contactqueries");
  const coupons = db.collection("coupons");

  const before = {
    menus: await menus.countDocuments(),
    products: await products.countDocuments(),
    orders: await orders.countDocuments(),
    users: await users.countDocuments(),
    queries: await queries.countDocuments().catch(() => 0),
    coupons: await coupons.countDocuments().catch(() => 0),
  };
  console.log("Before:", before);

  const keepMenus = await menus
    .find({ slug: { $in: KEEP_MENU_SLUGS }, parent: null })
    .project({ _id: 1, name: 1, slug: 1 })
    .toArray();
  console.log(
    "Keep menus:",
    keepMenus.map((m) => `${m.name} (${m.slug})`).join(", ") || "(none found)",
  );

  const keepProducts = await products
    .find({
      $or: [
        { category: { $in: KEEP_MENU_SLUGS } },
        { "specs.source": "Spectra Trade Price List 2026" },
      ],
    })
    .project({ name: 1, category: 1 })
    .toArray();
  console.log(`Keep products: ${keepProducts.length}`);

  const deleteProductFilter = {
    $nor: [
      { category: { $in: KEEP_MENU_SLUGS } },
      { "specs.source": "Spectra Trade Price List 2026" },
    ],
  };
  const deleteMenuFilter = {
    $nor: [{ slug: { $in: KEEP_MENU_SLUGS }, parent: null }],
  };

  const toDeleteProducts = await products.countDocuments(deleteProductFilter);
  const toDeleteMenus = await menus.countDocuments(deleteMenuFilter);

  console.log(`\nWill delete:`);
  console.log(`  products: ${toDeleteProducts}`);
  console.log(`  menus: ${toDeleteMenus}`);
  console.log(`  orders: ${before.orders}`);
  console.log(`  contact queries: ${before.queries}`);
  console.log(`  coupons: ${before.coupons}`);
  console.log(`  non-admin users: ${await users.countDocuments({ role: { $ne: "admin" } })}`);

  if (dry) {
    console.log("\nDry run only — no changes made.");
    await mongoose.disconnect();
    return;
  }

  const rProducts = await products.deleteMany(deleteProductFilter);
  const rMenus = await menus.deleteMany(deleteMenuFilter);
  const rOrders = await orders.deleteMany({});
  let rQueries = { deletedCount: 0 };
  let rCoupons = { deletedCount: 0 };
  try {
    rQueries = await queries.deleteMany({});
  } catch {}
  try {
    rCoupons = await coupons.deleteMany({});
  } catch {}
  const rUsers = await users.deleteMany({ role: { $ne: "admin" } });

  // Clear wishlists on remaining admins
  await users.updateMany({ role: "admin" }, { $set: { wishlist: [] } });

  // Drop other collections that may hold store data (safe list)
  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name);
  const extraWipe = [
    "addresses",
    "reviews",
    "newslettersubscribers",
    "subscribers",
  ].filter((n) => names.includes(n));
  for (const name of extraWipe) {
    const r = await db.collection(name).deleteMany({});
    console.log(`  wiped ${name}: ${r.deletedCount}`);
  }

  const after = {
    menus: await menus.countDocuments(),
    products: await products.countDocuments(),
    orders: await orders.countDocuments(),
    users: await users.countDocuments(),
    queries: await queries.countDocuments().catch(() => 0),
    coupons: await coupons.countDocuments().catch(() => 0),
  };

  console.log("\nDeleted:");
  console.log(`  products: ${rProducts.deletedCount}`);
  console.log(`  menus: ${rMenus.deletedCount}`);
  console.log(`  orders: ${rOrders.deletedCount}`);
  console.log(`  queries: ${rQueries.deletedCount}`);
  console.log(`  coupons: ${rCoupons.deletedCount}`);
  console.log(`  non-admin users: ${rUsers.deletedCount}`);
  console.log("\nAfter:", after);

  const leftoverMenus = await menus.find({}).project({ name: 1, slug: 1, parent: 1 }).toArray();
  console.log("\nRemaining menus:");
  for (const m of leftoverMenus) {
    console.log(`  - ${m.name} (${m.slug})${m.parent ? " [child]" : ""}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

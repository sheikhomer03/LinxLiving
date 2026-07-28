/**
 * Delete known test brands / menus / collections / coupons.
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/delete-test-data.cjs
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

const TEST_BRAND_SLUGS = ["testing", "xyz12"];
const TEST_COLLECTION_SLUGS = ["test-twuayhi", "xyz"];
const TEST_COUPON_CODES = ["TESTING", "XYZDISCOUNT"];

async function main() {
  const dry = process.env.DRY_RUN === "1";
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const brands = await db
    .collection("brands")
    .find({ slug: { $in: TEST_BRAND_SLUGS } })
    .toArray();
  const brandIds = brands.map((b) => b._id);

  console.log(
    "Brands to delete:",
    brands.map((b) => `${b.name} (${b.slug})`).join(", ") || "(none)",
  );

  const menus = brandIds.length
    ? await db
        .collection("menus")
        .find({
          $or: [
            { brand: { $in: brandIds } },
            { slug: { $in: ["testing-1"] } },
          ],
        })
        .toArray()
    : await db.collection("menus").find({ slug: "testing-1" }).toArray();

  console.log(
    "Menus to delete:",
    menus.map((m) => `${m.name} (${m.slug})`).join(", ") || "(none)",
  );

  const productsUnderTest = brandIds.length
    ? await db.collection("products").countDocuments({ brand: { $in: brandIds } })
    : 0;
  console.log("Products under test brands:", productsUnderTest);

  const collections = await db
    .collection("collections")
    .find({ slug: { $in: TEST_COLLECTION_SLUGS } })
    .toArray();
  console.log(
    "Collections to delete:",
    collections.map((c) => `${c.name} (${c.slug})`).join(", ") || "(none)",
  );

  const coupons = await db
    .collection("coupons")
    .find({ code: { $in: TEST_COUPON_CODES } })
    .toArray();
  console.log(
    "Coupons to delete:",
    coupons.map((c) => c.code).join(", ") || "(none)",
  );

  if (dry) {
    console.log("[dry] no writes");
    await mongoose.disconnect();
    return;
  }

  if (productsUnderTest > 0) {
    const delP = await db
      .collection("products")
      .deleteMany({ brand: { $in: brandIds } });
    console.log("Deleted products:", delP.deletedCount);
  }

  if (menus.length) {
    const delM = await db.collection("menus").deleteMany({
      _id: { $in: menus.map((m) => m._id) },
    });
    console.log("Deleted menus:", delM.deletedCount);
  }

  if (brandIds.length) {
    const delB = await db
      .collection("brands")
      .deleteMany({ _id: { $in: brandIds } });
    console.log("Deleted brands:", delB.deletedCount);
  }

  if (collections.length) {
    const delC = await db.collection("collections").deleteMany({
      _id: { $in: collections.map((c) => c._id) },
    });
    console.log("Deleted collections:", delC.deletedCount);
  }

  if (coupons.length) {
    const delCp = await db.collection("coupons").deleteMany({
      _id: { $in: coupons.map((c) => c._id) },
    });
    console.log("Deleted coupons:", delCp.deletedCount);
  }

  console.log("Done.");
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

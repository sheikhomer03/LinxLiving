/**
 * Scan MongoDB for obvious test / placeholder data.
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

const TEST_RE =
  /\b(test|testing|xyz12|dummy|sample|placeholder|demo|asdf|foo|bar)\b/i;

function looksTest(doc) {
  const fields = [
    doc.name,
    doc.title,
    doc.slug,
    doc.code,
    doc.description,
    doc.tagline,
  ]
    .filter(Boolean)
    .map(String);
  return fields.some((f) => TEST_RE.test(f));
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const cols = await db.listCollections().toArray();
  console.log(
    "collections:",
    cols.map((c) => c.name).sort().join(", "),
  );

  const report = {};

  // Brands
  const brands = await db.collection("brands").find({}).toArray();
  report.brands = {
    total: brands.length,
    all: brands.map((b) => ({
      id: String(b._id),
      name: b.name,
      slug: b.slug,
      isActive: b.isActive,
      test: looksTest(b),
    })),
    testLike: brands.filter(looksTest).map((b) => ({
      name: b.name,
      slug: b.slug,
    })),
  };

  // Menus
  const menus = await db
    .collection("menus")
    .find({})
    .project({ name: 1, slug: 1, parent: 1, brand: 1, isActive: 1 })
    .toArray();
  report.menus = {
    total: menus.length,
    testLike: menus.filter(looksTest).map((m) => ({
      name: m.name,
      slug: m.slug,
      brand: m.brand ? String(m.brand) : null,
    })),
  };

  // Products
  const products = await db
    .collection("products")
    .find({})
    .project({ name: 1, category: 1, brand: 1, description: 1, tagline: 1, price: 1 })
    .toArray();
  const testProducts = products.filter(looksTest);
  report.products = {
    total: products.length,
    testLikeCount: testProducts.length,
    testLike: testProducts.slice(0, 30).map((p) => ({
      id: String(p._id),
      name: p.name,
      category: p.category,
      brand: p.brand ? String(p.brand) : null,
      price: p.price,
    })),
  };

  // Discount / coupon style collections
  const discountNames = cols
    .map((c) => c.name)
    .filter((n) =>
      /discount|coupon|promo|voucher|code/i.test(n),
    );
  report.discountCollections = discountNames;

  for (const name of discountNames) {
    const docs = await db.collection(name).find({}).limit(50).toArray();
    report[name] = {
      total: await db.collection(name).countDocuments(),
      sample: docs.slice(0, 20).map((d) => ({
        id: String(d._id),
        code: d.code || d.name || d.slug,
        name: d.name,
        active: d.isActive ?? d.active,
        test: looksTest(d),
      })),
      testLike: docs.filter(looksTest).map((d) => ({
        code: d.code || d.name,
        name: d.name,
      })),
    };
  }

  // Also scan settings / misc for codes
  for (const name of ["discounts", "discountcodes", "coupons", "promocodes", "vouchers"]) {
    if (discountNames.includes(name)) continue;
    try {
      const n = await db.collection(name).countDocuments();
      if (n > 0) {
        report[`extra_${name}`] = n;
      }
    } catch {
      /* ignore */
    }
  }

  // Shopify collections if any
  if (cols.some((c) => c.name === "collections")) {
    const collections = await db
      .collection("collections")
      .find({})
      .project({ name: 1, slug: 1, title: 1 })
      .toArray();
    report.collections = {
      total: collections.length,
      testLike: collections.filter(looksTest).map((c) => ({
        name: c.name || c.title,
        slug: c.slug,
      })),
      all: collections.slice(0, 40).map((c) => ({
        name: c.name || c.title,
        slug: c.slug,
      })),
    };
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

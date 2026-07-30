/**
 * Assign brand ObjectId on products that match a brand's category menu slugs
 * but currently have brand null / missing.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/repair-product-brands.cjs
 *   DRY_RUN=1 node --require ./scripts/mongo-dns.cjs scripts/repair-product-brands.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.env.DRY_RUN === "1";

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brands = await db
    .collection("brands")
    .find({})
    .project({ name: 1, slug: 1 })
    .toArray();

  const summary = [];

  for (const brand of brands) {
    const menus = await db
      .collection("menus")
      .find({ brand: brand._id })
      .project({ slug: 1 })
      .toArray();
    const slugs = [...new Set(menus.map((m) => m.slug).filter(Boolean))];
    if (!slugs.length) {
      summary.push({
        brand: brand.name,
        slug: brand.slug,
        menuSlugs: [],
        matched: 0,
        updated: 0,
      });
      continue;
    }

    const filter = {
      $and: [
        {
          $or: [
            { category: { $in: slugs } },
            { subCategory: { $in: slugs } },
          ],
        },
        {
          $or: [{ brand: null }, { brand: { $exists: false } }],
        },
      ],
    };

    const matched = await db.collection("products").countDocuments(filter);
    let updated = 0;
    if (!DRY && matched) {
      const r = await db.collection("products").updateMany(filter, {
        $set: { brand: brand._id, updatedAt: new Date() },
      });
      updated = r.modifiedCount;
    }

    summary.push({
      brand: brand.name,
      slug: brand.slug,
      menuSlugs: slugs,
      matched,
      updated: DRY ? 0 : updated,
      dryRunWouldUpdate: DRY ? matched : undefined,
    });
  }

  console.log(JSON.stringify({ dryRun: DRY, summary }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

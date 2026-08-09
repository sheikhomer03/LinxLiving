/**
 * Move Cortizo, SMART, SCHUCO under UK Bifold Door Factory as sub-brands.
 *
 * - Adds Brand.subBrands on ukbifolddoorfactory
 * - Reassigns products + menus to parent brand with product/menu.subBrand set
 * - Deactivates the three old top-level brands (keeps docs for history)
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/merge-bifold-subbrands.cjs
 *   DRY_RUN=1 node --require ./scripts/mongo-dns.cjs scripts/merge-bifold-subbrands.cjs
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const PARENT_SLUG = "ukbifolddoorfactory";

const CHILD_BRANDS = [
  { slug: "cortizo", subSlug: "cortizo", subName: "Cortizo" },
  { slug: "smart", subSlug: "smart", subName: "SMART" },
  { slug: "schuco", subSlug: "schuco", subName: "SCHUCO" },
];

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const parent = await db.collection("brands").findOne({ slug: PARENT_SLUG });
  if (!parent) throw new Error(`Parent brand ${PARENT_SLUG} not found`);

  console.log(
    `Parent: ${parent.name} (${parent.slug})${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  const children = [];
  for (const c of CHILD_BRANDS) {
    const brand = await db.collection("brands").findOne({ slug: c.slug });
    if (!brand) throw new Error(`Child brand ${c.slug} not found`);
    const products = await db.collection("products").countDocuments({
      $or: [{ brand: brand._id }, { brands: brand._id }],
    });
    const menus = await db
      .collection("menus")
      .countDocuments({ brand: brand._id });
    children.push({ ...c, brand, products, menus });
    console.log(
      `  child ${brand.name}: products=${products} menus=${menus}`,
    );
  }

  const subBrands = [
    ...(Array.isArray(parent.subBrands) ? parent.subBrands : []),
  ];
  for (const c of children) {
    if (!subBrands.some((s) => String(s.slug).toLowerCase() === c.subSlug)) {
      subBrands.push({ name: c.subName, slug: c.subSlug });
    }
  }

  if (!DRY_RUN) {
    await db.collection("brands").updateOne(
      { _id: parent._id },
      { $set: { subBrands, updatedAt: new Date() } },
    );
  }
  console.log(
    `Parent subBrands: ${subBrands.map((s) => s.slug).join(", ")}`,
  );

  let productsMoved = 0;
  let menusMoved = 0;

  for (const c of children) {
    const productFilter = {
      $or: [{ brand: c.brand._id }, { brands: c.brand._id }],
    };
    const products = await db
      .collection("products")
      .find(productFilter)
      .project({ _id: 1, brands: 1, brand: 1 })
      .toArray();

    for (const p of products) {
      const brands = Array.isArray(p.brands) ? [...p.brands] : [];
      const nextBrands = brands
        .map((id) => String(id))
        .filter((id) => id !== String(c.brand._id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (!nextBrands.some((id) => String(id) === String(parent._id))) {
        nextBrands.push(parent._id);
      }

      if (!DRY_RUN) {
        await db.collection("products").updateOne(
          { _id: p._id },
          {
            $set: {
              brand: parent._id,
              brands: nextBrands,
              subBrand: c.subSlug,
              updatedAt: new Date(),
            },
          },
        );
      }
      productsMoved++;
    }

    const menuRes = DRY_RUN
      ? { modifiedCount: c.menus }
      : await db.collection("menus").updateMany(
          { brand: c.brand._id },
          {
            $set: {
              brand: parent._id,
              subBrand: c.subSlug,
              updatedAt: new Date(),
            },
            $addToSet: { subBrands: c.subSlug },
          },
        );
    menusMoved += menuRes.modifiedCount || 0;

    if (!DRY_RUN) {
      await db.collection("brands").updateOne(
        { _id: c.brand._id },
        {
          $set: {
            isActive: false,
            updatedAt: new Date(),
            // Keep a breadcrumb for admins
            uiName: String(c.brand.uiName || "").trim() || undefined,
          },
          $setOnInsert: {},
        },
      );
      // Clear empty uiName overwrite if we set undefined poorly — do explicit deactivate
      await db.collection("brands").updateOne(
        { _id: c.brand._id },
        { $set: { isActive: false, updatedAt: new Date() } },
      );
    }
    console.log(
      `  moved ${c.subSlug}: products=${products.length} menus=${menuRes.modifiedCount || 0} (deactivated ${c.slug})`,
    );
  }

  // Verify
  const parentProducts = await db.collection("products").countDocuments({
    $or: [{ brand: parent._id }, { brands: parent._id }],
  });
  const bySub = await db
    .collection("products")
    .aggregate([
      {
        $match: {
          $or: [{ brand: parent._id }, { brands: parent._id }],
        },
      },
      { $group: { _id: "$subBrand", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  const parentMenus = await db
    .collection("menus")
    .countDocuments({ brand: parent._id });
  const activeTop = await db
    .collection("brands")
    .find({
      slug: { $in: [PARENT_SLUG, ...CHILD_BRANDS.map((c) => c.slug)] },
    })
    .project({ slug: 1, isActive: 1, subBrands: 1 })
    .toArray();

  console.log("\n========== BIFOLD SUB-BRAND MERGE ==========");
  console.log(`Products moved this run: ${productsMoved}`);
  console.log(`Menus moved this run: ${menusMoved}`);
  console.log(`Parent products now: ${parentProducts}`);
  console.log(`Parent menus now: ${parentMenus}`);
  console.log(
    `By subBrand: ${bySub.map((r) => `${r._id || "(none)"}:${r.n}`).join(", ")}`,
  );
  console.log(
    "Brand active flags:",
    activeTop.map((b) => `${b.slug}=${b.isActive}`).join(", "),
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

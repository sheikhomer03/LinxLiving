/**
 * Put AlunoTec's four Palora ranges under one "Awning" main category.
 *
 * They were imported as four top-level categories sitting directly under
 * Outdoor Living — Manual/Motorized × P4/P6 — which reads as four unrelated
 * departments-worth of nav for eight products. They are four variants of one
 * thing, so this creates the main category they belong under and demotes them
 * to its subcategories.
 *
 * Two sides have to move together:
 *
 *   menus     the four rows get `parent` = Awning and `level` = subcategory;
 *             Awning itself is inserted as the category, keeping their brand
 *             and department so the nav and department pages still find them.
 *   products  `category` becomes "awning" and the old category slug drops to
 *             `subCategory`. The multi-valued `categories[]` moves down to
 *             `subCategories[]` the same way, which is what preserves the
 *             cross-listing four of these products rely on (a P4 blind is
 *             listed under both the manual and motorized P4 ranges).
 *
 * Shopify is not touched here. The menus are mirrored as `menu-*` collections
 * and each product's category rides along as its Shopify product type and
 * tags, so both need re-pushing afterwards — see the note this prints on
 * success.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/create-awning-category.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/create-awning-category.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/create-awning-category.cjs --rollback <file.json>
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const BRAND = "AlunoTec";
const MAIN = { name: "Awning", slug: "awning" };

/**
 * The order the four ranges should read in the nav. Three of them currently
 * share `order: 0`, so their sequence is whatever Mongo returns — worth fixing
 * while they are being moved anyway.
 */
const CHILD_ORDER = [
  "manual-palora-p4",
  "motorized-palora-p4",
  "manual-palora-p6",
  "motorized-palora-p6",
];

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const oid = (v) => new mongoose.Types.ObjectId(v);

  let menus = 0;
  for (const m of data.menus || []) {
    await db.collection("menus").updateOne(
      { _id: oid(m._id) },
      {
        $set: {
          parent: m.parent ? oid(m.parent) : null,
          level: m.level,
          order: m.order,
        },
      },
    );
    menus += 1;
  }

  let products = 0;
  for (const p of data.products || []) {
    await db.collection("products").updateOne(
      { _id: oid(p._id) },
      {
        $set: {
          category: p.category,
          categories: p.categories,
          subCategory: p.subCategory,
          subCategories: p.subCategories,
        },
      },
    );
    products += 1;
  }

  let removed = 0;
  if (data.insertedMenuId) {
    const r = await db
      .collection("menus")
      .deleteOne({ _id: oid(data.insertedMenuId) });
    removed = r.deletedCount;
  }

  console.log(
    `rolled back: ${menus} menus restored, ${products} products restored, ${removed} menu removed`,
  );
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const menusCol = db.collection("menus");
  const productsCol = db.collection("products");

  if (ROLLBACK) {
    await runRollback(db, ROLLBACK);
    await mongoose.disconnect();
    return;
  }

  const brand = await db
    .collection("brands")
    .findOne({ name: new RegExp(`^${BRAND}$`, "i") });
  if (!brand) throw new Error(`Brand "${BRAND}" not found`);

  const children = await menusCol
    .find({ brand: brand._id, parent: null })
    .toArray();
  if (!children.length) throw new Error("No top-level menus for this brand");

  const unexpected = children.filter((m) => !CHILD_ORDER.includes(m.slug));
  if (unexpected.length) {
    throw new Error(
      `Top-level menus this script does not know about: ${unexpected
        .map((m) => m.slug)
        .join(", ")}. Refusing to guess where they belong.`,
    );
  }

  // Every child agrees on the department, so the new main inherits it.
  const departments = [...new Set(children.map((m) => String(m.department)))];
  if (departments.length !== 1) {
    throw new Error(`Children span ${departments.length} departments — resolve by hand`);
  }
  const departmentId = children[0].department;

  const existingMain = await menusCol.findOne({ slug: MAIN.slug });
  if (existingMain && String(existingMain.brand) !== String(brand._id)) {
    throw new Error(
      `A menu with slug "${MAIN.slug}" already exists on another brand — pick a different slug`,
    );
  }

  const products = await productsCol
    .find({ $or: [{ brand: brand._id }, { brands: brand._id }] })
    .toArray();

  console.log(`brand      : ${brand.name}`);
  console.log(`department : ${departmentId}`);
  console.log(
    `main       : ${existingMain ? `"${MAIN.name}" already exists — reusing` : `create "${MAIN.name}" (${MAIN.slug})`}`,
  );
  console.log(`\nmenus to demote to subcategories of ${MAIN.name}: ${children.length}`);
  for (const slug of CHILD_ORDER) {
    const m = children.find((x) => x.slug === slug);
    if (!m) continue;
    console.log(
      `   ${m.slug.padEnd(22)} "${m.name}"  order ${m.order} -> ${CHILD_ORDER.indexOf(slug)}`,
    );
  }

  console.log(`\nproducts to retag: ${products.length}`);
  for (const p of products) {
    console.log(
      `   ${String(p.name).slice(0, 44).padEnd(46)} ` +
        `category ${p.category} -> ${MAIN.slug}, subCategory "${p.subCategory || ""}" -> ${p.category}`,
    );
    const cats = Array.isArray(p.categories) ? p.categories : [];
    if (cats.length > 1) {
      console.log(`      cross-listed in ${JSON.stringify(cats)} -> subCategories`);
    }
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const rollback = { insertedMenuId: null, menus: [], products: [] };

  let mainId = existingMain?._id;
  if (!mainId) {
    const inserted = await menusCol.insertOne({
      name: MAIN.name,
      slug: MAIN.slug,
      parent: null,
      order: 0,
      group: "",
      url: "",
      isActive: true,
      image: "",
      brand: brand._id,
      subBrand: "",
      subBrands: [],
      department: departmentId,
      level: "category",
      shopifyCollectionId: null,
      shopifySyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    mainId = inserted.insertedId;
    rollback.insertedMenuId = String(mainId);
  }

  for (const m of children) {
    rollback.menus.push({
      _id: String(m._id),
      parent: m.parent ? String(m.parent) : null,
      level: m.level ?? "category",
      order: m.order ?? 0,
    });
    await menusCol.updateOne(
      { _id: m._id },
      {
        $set: {
          parent: mainId,
          level: "subcategory",
          order: CHILD_ORDER.indexOf(m.slug),
          updatedAt: now,
        },
      },
    );
  }

  for (const p of products) {
    const oldCategory = p.category || "";
    const oldCategories = Array.isArray(p.categories) ? p.categories : [];
    const oldSubCategory = p.subCategory ?? "";
    const oldSubCategories = Array.isArray(p.subCategories) ? p.subCategories : [];

    rollback.products.push({
      _id: String(p._id),
      category: oldCategory,
      categories: oldCategories,
      subCategory: oldSubCategory,
      subCategories: oldSubCategories,
    });

    // The old category becomes the subcategory; the cross-listing that lived
    // in `categories[]` moves down with it rather than being flattened away.
    const nextSubCategories = [
      ...new Set([...oldSubCategories, ...oldCategories, oldCategory].filter(Boolean)),
    ];

    await productsCol.updateOne(
      { _id: p._id },
      {
        $set: {
          category: MAIN.slug,
          categories: [MAIN.slug],
          subCategory: oldCategory,
          subCategories: nextSubCategories,
        },
      },
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-awning-category-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));

  console.log(
    `\napplied:\n` +
      `  ${rollback.insertedMenuId ? "1 menu created" : "0 menus created (reused existing)"}\n` +
      `  ${rollback.menus.length} menus demoted to subcategories\n` +
      `  ${rollback.products.length} products retagged\n` +
      `rollback: ${file}\n\n` +
      `Shopify still shows the old shape. Re-push with:\n` +
      `  node --require ./scripts/mongo-dns.cjs scripts/sync-awning-to-shopify.cjs\n`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

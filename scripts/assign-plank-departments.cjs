/**
 * Put the Plank Hardware catalogue into the storefront departments.
 *
 * Plank's 104 menus and 488 products were imported with no department, so none
 * of it reaches the navbar: getDepartmentTrees() keeps a category only when
 * `${departmentSlug}::${categorySlug}` appears in the product index, and a
 * department only when it has both products and a surviving category.
 *
 * Mapping follows the taxonomy already in the database rather than inventing
 * one — Electrical holds Ceiling Lights, Wall Lights and Sockets & Switches,
 * and Accessories holds the fixings, fittings and installation ranges.
 *
 *   Knobs & Handles           -> Accessories
 *   By Finish                 -> Accessories
 *   Hooks & Accessories       -> Accessories
 *   Taps                      -> Accessories
 *   Light Switches & Sockets  -> Electrical
 *   Lighting                  -> Electrical
 *
 * Menus store a department ObjectId, products store the slug. Sub-categories
 * take their main's department, which is what createMenu already does when a
 * child is added under a parent.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/assign-plank-departments.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/assign-plank-departments.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/assign-plank-departments.cjs --rollback <file.json>
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** Plank main-category slug -> department slug. */
const MENU_MAP = {
  "all-cabinet-hardware": "accessories",
  "shop-by-finish": "accessories",
  "hooks-accessories": "accessories",
  "kitchen-mixer-taps": "accessories",
  "light-switches-sockets": "electrical",
  "home-lighting": "electrical",
};

/**
 * Product category -> department slug. The first six mirror MENU_MAP; the rest
 * are leftovers from the import that are not navbar categories. `gift-card` is
 * deliberately absent so it stays out of the storefront.
 */
const PRODUCT_MAP = {
  "all-cabinet-hardware": "accessories",
  "shop-by-finish": "accessories",
  "hooks-accessories": "accessories",
  "kitchen-mixer-taps": "accessories",
  "light-switches-sockets": "electrical",
  "home-lighting": "electrical",
  electric: "electrical",
  accessories: "accessories",
  components: "accessories",
};

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const M = db.collection("menus");
  const P = db.collection("products");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    let m = 0;
    for (const r of data.menus || []) {
      await M.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        { $set: { department: r.department ? new mongoose.Types.ObjectId(r.department) : null } },
      );
      m += 1;
    }
    let p = 0;
    for (const r of data.products || []) {
      await P.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        { $set: { department: r.department } },
      );
      p += 1;
    }
    console.log(`rolled back ${m} menus and ${p} products`);
    await mongoose.disconnect();
    return;
  }

  const brand = await db.collection("brands").findOne({ name: /^plank hardware$/i });
  if (!brand) throw new Error("Plank Hardware brand not found");

  const wanted = [...new Set([...Object.values(MENU_MAP), ...Object.values(PRODUCT_MAP)])];
  const depts = await db.collection("departments").find({ slug: { $in: wanted } }).toArray();
  const deptBySlug = new Map(depts.map((d) => [d.slug, d]));
  for (const slug of wanted) {
    if (!deptBySlug.has(slug)) throw new Error(`department not found: ${slug}`);
    if (deptBySlug.get(slug).isActive === false) {
      throw new Error(`department is inactive, would stay hidden: ${slug}`);
    }
  }

  // --- menus -------------------------------------------------------------
  const menus = await M.find({ brand: brand._id }).toArray();
  const tops = menus.filter((m) => !m.parent);
  const byId = new Map(menus.map((m) => [String(m._id), m]));

  const unmapped = tops.filter((t) => !MENU_MAP[t.slug]);
  if (unmapped.length) {
    throw new Error(`main category with no mapping: ${unmapped.map((t) => t.slug).join(", ")}`);
  }

  const menuUpdates = [];
  for (const m of menus) {
    // A child takes its main's department.
    const main = m.parent ? byId.get(String(m.parent)) : m;
    const deptSlug = main ? MENU_MAP[main.slug] : null;
    if (!deptSlug) continue;
    const dept = deptBySlug.get(deptSlug);
    if (String(m.department || "") === String(dept._id)) continue;
    menuUpdates.push({ doc: m, dept, deptSlug });
  }

  // --- products ----------------------------------------------------------
  const products = await P.find({ brand: brand._id })
    .project({ name: 1, category: 1, department: 1 })
    .toArray();

  const productUpdates = [];
  const skippedProducts = [];
  for (const p of products) {
    const deptSlug = PRODUCT_MAP[String(p.category || "").trim()];
    if (!deptSlug) { skippedProducts.push(p); continue; }
    if (String(p.department || "") === deptSlug) continue;
    productUpdates.push({ doc: p, deptSlug });
  }

  const tally = (rows, key) =>
    rows.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] || 0) + 1), acc), {});

  console.log(`menus to update   : ${menuUpdates.length} of ${menus.length}`);
  console.log(`   ${JSON.stringify(tally(menuUpdates, "deptSlug"))}`);
  for (const t of tops) {
    const kids = menus.filter((m) => String(m.parent) === String(t._id));
    console.log(`   ${t.name.padEnd(26)} -> ${MENU_MAP[t.slug].padEnd(12)} (self + ${kids.length} sub-categories)`);
  }

  console.log(`\nproducts to update: ${productUpdates.length} of ${products.length}`);
  console.log(`   ${JSON.stringify(tally(productUpdates, "deptSlug"))}`);
  console.log(`   left with no department: ${skippedProducts.length}` +
    (skippedProducts.length ? ` (${[...new Set(skippedProducts.map((p) => p.category || "(none)"))].join(", ")})` : ""));

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = {
    menus: menuUpdates.map((u) => ({
      _id: String(u.doc._id),
      department: u.doc.department ? String(u.doc.department) : null,
    })),
    products: productUpdates.map((u) => ({
      _id: String(u.doc._id),
      department: u.doc.department === undefined ? "" : u.doc.department,
    })),
  };

  const now = new Date();
  for (let i = 0; i < menuUpdates.length; i += 200) {
    await M.bulkWrite(
      menuUpdates.slice(i, i + 200).map((u) => ({
        updateOne: {
          filter: { _id: u.doc._id },
          update: { $set: { department: u.dept._id, updatedAt: now } },
        },
      })),
      { ordered: false },
    );
  }
  for (let i = 0; i < productUpdates.length; i += 200) {
    await P.bulkWrite(
      productUpdates.slice(i, i + 200).map((u) => ({
        updateOne: {
          filter: { _id: u.doc._id },
          update: { $set: { department: u.deptSlug, updatedAt: now } },
        },
      })),
      { ordered: false },
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-plank-departments-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
  console.log(`\napplied: ${menuUpdates.length} menus, ${productUpdates.length} products\nrollback: ${file}`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

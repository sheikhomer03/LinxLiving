const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * The accessory ranges that were still showing under product departments.
 *
 * Britmet's fixings and flashings sat under Roofing, Noken's towel warmers
 * and mirrors under Bathrooms, MB Decor's external trims under Outdoor
 * Living. Both halves move: the products (so the catalogue filters agree) and
 * the menu records (so the navbar tab stops listing them), because the navbar
 * builds its columns from the `menus` collection, not from products.
 *
 * Writes only `department` on products and menus. No prices, names, images,
 * categories, subcategories or configurator data are touched.
 *
 *   node scripts/move-remaining-accessories.cjs                 # dry run
 *   node scripts/move-remaining-accessories.cjs --apply
 *   node scripts/move-remaining-accessories.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** Category slugs to pull into Accessories, wherever they currently sit. */
const CATEGORIES = [
  "panel-flashings",
  "panel-fixings",
  "panel-accessories",
  "misc-accessories",
  "external-trims",
  "towel-warmers",
  "mirror",
];

/**
 * Accessory ranges that exist one level down, as subcategories.
 *
 * The Under Floor Heating files its fitting kits, tools and foils under
 * `electric-underfloor-heating` and `water-underfloor-heating`, so a
 * category-level move leaves them behind in the Heating tab.
 */
const SUBCATEGORIES = [
  "electric-underfloor-heating-accessories",
  "solar-pv-accessories",
  "water-underfloor-heating-tools",
  "water-underfloor-heating-fixing-systems",
  "wetroom-installation-tools",
  "underfloor-heating-foil",
  "decoupling",
  // FAKRO files roof-window flashings as a subcategory of the windows
  // themselves — 185 products that are fitting parts, not windows.
  "flashing-kits",
  "towel-radiators",

  // Under Floor Heating fitting materials and parts. The heating elements
  // themselves — mats, cables, in-screed, and the water UFH output ranges —
  // stay under Heating; everything you fit around them moves here.
  "couplings",
  "actuators",
  "underfloor-heating-pipes",
  "underfloor-heating-manifolds",
  "underfloor-heating-pumps",
  "electrical",
  "installation",
  "wiring-centres",
  "thermal-imaging-cameras",
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const P = mongoose.connection.collection("products");
  const M = mongoose.connection.collection("menus");
  const D = mongoose.connection.collection("departments");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const p of data.products) {
      await P.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { department: p.department } },
      );
    }
    for (const m of data.menus) {
      await M.updateOne(
        { _id: new mongoose.Types.ObjectId(m._id) },
        {
          $set: {
            department: m.department
              ? new mongoose.Types.ObjectId(m.department)
              : null,
          },
        },
      );
    }
    console.log(
      `Rolled back ${data.products.length} products and ${data.menus.length} menus.`,
    );
    await mongoose.disconnect();
    return;
  }

  const accessories = await D.findOne({ slug: "accessories" });
  if (!accessories) throw new Error("accessories department missing");

  const products = await P.find({
    $or: [
      { category: { $in: CATEGORIES } },
      { subCategory: { $in: SUBCATEGORIES } },
    ],
    department: { $ne: "accessories" },
  })
    .project({ _id: 1, department: 1, category: 1, subCategory: 1 })
    .toArray();

  const menus = await M.find({
    slug: { $in: [...CATEGORIES, ...SUBCATEGORIES] },
    department: { $nin: [accessories._id, null] },
  })
    .project({ _id: 1, slug: 1, department: 1 })
    .toArray();

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  const summary = {};
  products.forEach((p) => {
    const key = `${p.department || "(none)"} / ${p.category}${p.subCategory ? ` / ${p.subCategory}` : ""}`;
    summary[key] = (summary[key] || 0) + 1;
  });
  console.log("\nPRODUCTS");
  console.table(summary);
  console.log(`   total: ${products.length}`);
  console.log("\nMENU RECORDS");
  menus.forEach((m) => console.log(`   ${m.slug}`));
  console.log(`   total: ${menus.length}`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-remaining-accessories-${stamp}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        products: products.map((p) => ({
          _id: String(p._id),
          department: p.department ?? "",
        })),
        menus: menus.map((m) => ({
          _id: String(m._id),
          department: m.department ? String(m.department) : null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nRollback written: ${file}`);

  if (products.length) {
    await P.updateMany(
      { _id: { $in: products.map((p) => p._id) } },
      { $set: { department: "accessories" } },
    );
  }
  if (menus.length) {
    await M.updateMany(
      { _id: { $in: menus.map((m) => m._id) } },
      { $set: { department: accessories._id } },
    );
  }
  console.log(`Moved ${products.length} products and ${menus.length} menu records.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

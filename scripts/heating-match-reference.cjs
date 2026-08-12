const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Make Heating match theunderfloorheatingstore.com's two UFH collections.
 *
 * Those pages keep the fitting components inside the heating collections
 * rather than in a separate accessories section:
 *
 *   Electric UFH — mats, cables, foil, in-screed, insulation boards,
 *                  thermostats, decoupling, thermal imaging cameras,
 *                  electrical components, installation tools
 *   Water UFH    — low profile / standard / high output / multi-room kits,
 *                  fixing systems, pipes, manifolds, wiring centres,
 *                  thermostats, couplings & valves, thermal imaging,
 *                  actuators, pumps, tools
 *
 * This reverses the earlier moves for exactly those ranges. General trade
 * consumables that appear on neither page — tile adhesive, levellers,
 * primers, grouts, plumbing fittings — stay in Accessories.
 *
 * Writes only `department` on products and `parent`/`department` on menus.
 * No prices, names, images, categories or configurator data are touched.
 *
 *   node scripts/heating-match-reference.cjs                 # dry run
 *   node scripts/heating-match-reference.cjs --apply
 *   node scripts/heating-match-reference.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** Sub-ranges the reference collections list under Heating. */
const BACK_TO_HEATING = [
  // electric
  "underfloor-heating-mats",
  "underfloor-heating-cables",
  "underfloor-heating-foil",
  "inscreed-heating",
  "decoupling",
  "electric-underfloor-heating-accessories",
  "electrical",
  "installation",
  "thermal-imaging-cameras",
  // water
  "water-underfloor-heating-fixing-systems",
  "water-underfloor-heating-tools",
  "underfloor-heating-pipes",
  "underfloor-heating-manifolds",
  "underfloor-heating-pumps",
  "couplings",
  "actuators",
  "wiring-centres",
  // shared
  "insulation-boards",
];

/** Menu slug → the Heating parent it belongs under. */
const MENU_PARENT = {
  "underfloor-heating-mats": "electric-underfloor-heating",
  "underfloor-heating-cables": "electric-underfloor-heating",
  "underfloor-heating-foil": "electric-underfloor-heating",
  "inscreed-heating": "electric-underfloor-heating",
  decoupling: "electric-underfloor-heating",
  "electric-underfloor-heating-accessories": "electric-underfloor-heating",
  electrical: "electric-underfloor-heating",
  installation: "electric-underfloor-heating",
  "thermal-imaging-cameras": "water-underfloor-heating",
  "water-underfloor-heating-fixing-systems": "water-underfloor-heating",
  "water-underfloor-heating-tools": "water-underfloor-heating",
  "underfloor-heating-pipes": "water-underfloor-heating",
  "underfloor-heating-manifolds": "water-underfloor-heating",
  "underfloor-heating-pumps": "water-underfloor-heating",
  couplings: "water-underfloor-heating",
  actuators: "water-underfloor-heating",
  "wiring-centres": "water-underfloor-heating",
  "insulation-boards": "electric-underfloor-heating",
};

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
            parent: m.parent ? new mongoose.Types.ObjectId(m.parent) : null,
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

  const heating = await D.findOne({ slug: "heating" });
  if (!heating) throw new Error("heating department missing");

  const products = await P.find({
    subCategory: { $in: BACK_TO_HEATING },
    department: { $ne: "heating" },
  })
    .project({ _id: 1, department: 1, category: 1, subCategory: 1 })
    .toArray();

  const menuPlan = [];
  for (const [slug, parentSlug] of Object.entries(MENU_PARENT)) {
    const parent = await M.findOne({ slug: parentSlug, department: heating._id });
    if (!parent) {
      console.warn(`  ! heating parent not found: ${parentSlug}`);
      continue;
    }
    const rows = await M.find({ slug })
      .project({ _id: 1, slug: 1, parent: 1, department: 1 })
      .toArray();
    for (const r of rows) {
      if (String(r.parent || "") === String(parent._id)) continue;
      menuPlan.push({
        _id: r._id,
        slug: r.slug,
        toParent: parent._id,
        toParentSlug: parentSlug,
        previousParent: r.parent ? String(r.parent) : null,
        previousDepartment: r.department ? String(r.department) : null,
      });
    }
  }

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  const summary = {};
  products.forEach((p) => {
    const key = `${p.department} / ${p.subCategory}`;
    summary[key] = (summary[key] || 0) + 1;
  });
  console.log("\nPRODUCTS BACK TO HEATING");
  console.table(summary);
  console.log(`   total: ${products.length}`);
  console.log("\nMENUS BACK UNDER HEATING");
  menuPlan.forEach((m) => console.log(`   ${m.slug} -> ${m.toParentSlug}`));
  console.log(`   total: ${menuPlan.length}`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-heating-match-${stamp}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        products: products.map((p) => ({
          _id: String(p._id),
          department: p.department ?? "",
        })),
        menus: menuPlan.map((m) => ({
          _id: String(m._id),
          parent: m.previousParent,
          department: m.previousDepartment,
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
      { $set: { department: "heating" } },
    );
  }
  for (const m of menuPlan) {
    await M.updateOne(
      { _id: m._id },
      { $set: { parent: m.toParent, department: null } },
    );
  }
  console.log(
    `Restored ${products.length} products and ${menuPlan.length} menus to Heating.`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

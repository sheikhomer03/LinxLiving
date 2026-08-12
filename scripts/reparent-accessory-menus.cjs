const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Re-parent accessory sub-menus so they stop appearing under product tabs.
 *
 * A child menu carries `department: null` and inherits its parent's — so
 * "Electric Underfloor Heating Accessories", parented to
 * "electric-underfloor-heating", keeps rendering under Heating no matter
 * where its products were moved. Moving the products fixed the catalogue;
 * this fixes the menu.
 *
 * Each entry is re-parented to an existing Accessories menu, so it appears in
 * the Accessories tab alongside the rest of the fitting materials.
 *
 * Writes only `parent` and `department` on menu records. No products, prices,
 * names, images, categories or configurator data are touched.
 *
 *   node scripts/reparent-accessory-menus.cjs                 # dry run
 *   node scripts/reparent-accessory-menus.cjs --apply
 *   node scripts/reparent-accessory-menus.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** child menu slug → Accessories parent menu slug it should sit under. */
const REPARENT = {
  "electric-underfloor-heating-accessories": "insulation-fixings",
  "water-underfloor-heating-fixing-systems": "insulation-fixings",
  "underfloor-heating-foil": "insulation-fixings",
  decoupling: "insulation-fixings",
  "thermal-imaging-cameras": "insulation-fixings",
  "water-underfloor-heating-tools": "insulation-fixings",
  "wetroom-installation-tools": "adhesives-levellers",
  // Caught on a second pass — both inherit Heating through their parent.
  installation: "insulation-fixings",
  "solar-pv-accessories": "insulation-fixings",
  "underfloor-heating-manifolds": "plumbing",
  "underfloor-heating-pipes": "plumbing",
  // Products already moved to Accessories; their menus were still parented
  // under the Heating ranges, so the tab kept listing them.
  electrical: "insulation-fixings",
  "wiring-centres": "insulation-fixings",
  couplings: "plumbing",
  actuators: "plumbing",
  "underfloor-heating-pumps": "plumbing",
  // Third sweep: menus whose products had already moved but which were still
  // parented under a product department, so the tab kept listing them.
  "flashing-kits": "flashings",
  mirrors: "mb-accessories",
  "heated-towel-rail": "mb-accessories",
  "towel-radiators": "mb-accessories",
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const M = mongoose.connection.collection("menus");
  const D = mongoose.connection.collection("departments");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
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
    console.log(`Rolled back ${data.menus.length} menu records.`);
    await mongoose.disconnect();
    return;
  }

  const accessories = await D.findOne({ slug: "accessories" });
  if (!accessories) throw new Error("accessories department missing");

  const plan = [];
  for (const [childSlug, parentSlug] of Object.entries(REPARENT)) {
    // Parent must itself already sit under Accessories.
    const parent = await M.findOne({
      slug: parentSlug,
      department: accessories._id,
    });
    if (!parent) {
      console.warn(`  ! accessories parent not found: ${parentSlug}`);
      continue;
    }
    const children = await M.find({ slug: childSlug })
      .project({ _id: 1, slug: 1, parent: 1, department: 1 })
      .toArray();
    for (const c of children) {
      if (String(c.parent || "") === String(parent._id)) continue;
      plan.push({
        _id: c._id,
        slug: c.slug,
        toParent: parent._id,
        toParentSlug: parentSlug,
        previousParent: c.parent ? String(c.parent) : null,
        previousDepartment: c.department ? String(c.department) : null,
      });
    }
  }

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  const summary = {};
  plan.forEach((p) => {
    const key = `${p.slug} -> under ${p.toParentSlug}`;
    summary[key] = (summary[key] || 0) + 1;
  });
  console.table(summary);
  console.log(`Menu records to re-parent: ${plan.length}`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-reparent-accessory-menus-${stamp}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        menus: plan.map((p) => ({
          _id: String(p._id),
          parent: p.previousParent,
          department: p.previousDepartment,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nRollback written: ${file}`);

  for (const p of plan) {
    await M.updateOne(
      { _id: p._id },
      { $set: { parent: p.toParent, department: null } },
    );
  }
  console.log(`Re-parented ${plan.length} menu records under Accessories.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

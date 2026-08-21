const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Point category menu records at the right department.
 *
 * The navbar builds its tabs from the `menus` collection, grouped by each
 * menu's `department` id — NOT from products. So moving products into
 * Electrical and Wall Panels was necessary but not sufficient: with no menu
 * records pointing at those departments, the tabs cannot render at all.
 *
 * Electrical (1,316 priced), Wall Panels (462) and Plumbing (131) all had
 * zero menu records. Pooky's categories were sitting on `department: null`,
 * MB Decor's panel ranges on Bathrooms.
 *
 * Writes only `department` on menu records. No products, prices, names,
 * images, categories or configurator data are touched.
 *
 *   node scripts/relink-menu-departments.cjs                 # dry run
 *   node scripts/relink-menu-departments.cjs --apply
 *   node scripts/relink-menu-departments.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** brand slug → { menu slug → department slug } */
const MOVES = {
  pooky: {
    lampshades: "electrical",
    "wall-lights": "electrical",
    "table-lamps": "electrical",
    "ceiling-lights": "electrical",
    "sockets-and-switches": "electrical",
    bathroom: "electrical",
  },
  "mb-decor": {
    decorwall: "wall-panels",
    vox: "wall-panels",
    dumaplast: "wall-panels",
    vilo: "wall-panels",
    "panel-stone": "wall-panels",
    "ceiling-panel": "wall-panels",
    "mb-accessories": "accessories",
  },
  "the-under-floor-heating": { plumbing: "plumbing" },
  // Accessory ranges follow their products into the Accessories tab.
  fakro: { "blinds-accessories": "accessories", accessories: "accessories" },
  sterlingbuild: { flashings: "accessories", accessories: "accessories" },
  noken: { "installation-systems": "accessories", accessories: "accessories" },
  porcelanosagrupo: {
    "installation-materials": "accessories",
    accessories: "accessories",
  },
  spectra: { "adhesive-grout-silicone": "accessories" },
  likewisefloors: { accessories: "accessories" },
  "direct-flooring-online": { accessories: "accessories" },
  ukbifolddoorfactory: { accessories: "accessories" },
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const M = mongoose.connection.collection("menus");
  const D = mongoose.connection.collection("departments");
  const B = mongoose.connection.collection("brands");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
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
    console.log(`Rolled back ${data.menus.length} menu records.`);
    await mongoose.disconnect();
    return;
  }

  const departments = await D.find({}).project({ slug: 1, name: 1 }).toArray();
  const deptBySlug = new Map(departments.map((d) => [d.slug, d]));
  const deptName = new Map(departments.map((d) => [String(d._id), d.name]));
  const brands = await B.find({}).project({ name: 1, slug: 1 }).toArray();
  const brandBySlug = new Map(brands.map((b) => [b.slug, b]));

  const plan = [];
  for (const [brandSlug, moves] of Object.entries(MOVES)) {
    const brand = brandBySlug.get(brandSlug);
    if (!brand) {
      console.warn(`  ! brand not found: ${brandSlug}`);
      continue;
    }
    for (const [menuSlug, deptSlug] of Object.entries(moves)) {
      const dept = deptBySlug.get(deptSlug);
      if (!dept) {
        console.warn(`  ! department not found: ${deptSlug}`);
        continue;
      }
      const rows = await M.find({ brand: brand._id, slug: menuSlug })
        .project({ _id: 1, name: 1, slug: 1, department: 1 })
        .toArray();
      for (const r of rows) {
        if (String(r.department || "") === String(dept._id)) continue;
        plan.push({
          _id: r._id,
          brand: brand.name,
          slug: r.slug,
          from: r.department ? deptName.get(String(r.department)) || "?" : "(null)",
          to: dept.name,
          toId: dept._id,
          previous: r.department ? String(r.department) : null,
        });
      }
    }
  }

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  const summary = {};
  plan.forEach((p) => {
    const key = `${p.brand} / ${p.slug}: ${p.from} -> ${p.to}`;
    summary[key] = (summary[key] || 0) + 1;
  });
  console.table(summary);
  console.log(`Menu records to relink: ${plan.length}`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-relink-menus-${stamp}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      { menus: plan.map((p) => ({ _id: String(p._id), department: p.previous })) },
      null,
      2,
    ),
  );
  console.log(`\nRollback written: ${file}`);

  for (const p of plan) {
    await M.updateOne({ _id: p._id }, { $set: { department: p.toId } });
  }
  console.log(`Relinked ${plan.length} menu records.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

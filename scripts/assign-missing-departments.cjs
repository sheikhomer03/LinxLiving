const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Give the 1,641 products with no `department` one, so they appear under the
 * navbar department tabs.
 *
 * A product with no department is invisible in the mega menu no matter how the
 * columns are designed — this is why several departments look half-empty.
 *
 * Rules are per brand + category, not guessed from keywords: each entry below
 * was read off the live category list. Anything not matched is left alone and
 * reported, so nothing is swept into a department by accident.
 *
 * Only `department` is written. No prices, names, images, categories,
 * subcategories or configurator data are touched.
 *
 *   node scripts/assign-missing-departments.cjs                 # dry run
 *   node scripts/assign-missing-departments.cjs --apply
 *   node scripts/assign-missing-departments.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** brand slug → { category slug → department slug } */
const RULES = {
  "direct-flooring-online": {
    "lvt-flooring": "flooring",
    "laminate-flooring": "flooring",
    "wood-flooring": "flooring",
    "parquet-flooring": "flooring",
    accessories: "accessories",
    "laminate-flooring-accessories": "accessories",
  },
  "otto-tiles": {
    "signature-collection": "tiles",
    terrazzo: "tiles",
    "encaustic-cement": "tiles",
    "zellige-and-bejmat": "tiles",
    ceramic: "tiles",
  },
  "the-under-floor-heating": {
    plumbing: "plumbing",
    bathrooms: "bathrooms",
    "energy-efficiency": "heating",
    "pallet-deals": "heating",
  },
  ukbifolddoorfactory: {
    windows: "windows-and-doors",
    doors: "windows-and-doors",
    "hinged-window-and-door-systems": "windows-and-doors",
    "sliding-window-and-door-systems": "windows-and-doors",
    "cortizo-pvc": "windows-and-doors",
    "facade-systems": "windows-and-doors",
    "curtain-wall": "windows-and-doors",
    "solar-protection": "windows-and-doors",
    "balustrading-system": "windows-and-doors",
    "sliding-doors": "windows-and-doors",
    claddings: "wall-panels",
    accessories: "accessories",
  },
  porcelanosagrupo: {
    "floor-and-wall": "tiles",
    bathrooms: "bathrooms",
    "installation-materials": "accessories",
  },
  "natura-flooring": {
    "trade-flooring": "flooring",
    "the-family-floor-engineered-hardwood-flooring": "flooring",
    "engineered-wood-flooring": "flooring",
    "herringbone-wood-flooring": "flooring",
    "solid-wood-flooring": "flooring",
  },
  britmet: { "lightweight-roofing": "roofing" },
  fakro: { "roof-lanterns": "rooflights-and-glass" },
  likewisefloors: { carpet: "flooring" },
  "mb-decor": { "mb-accessories": "accessories", "mb-outdoor": "outdoor-living" },
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const P = mongoose.connection.collection("products");
  const B = mongoose.connection.collection("brands");
  const D = mongoose.connection.collection("departments");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const p of data.products) {
      await P.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { department: p.department } },
      );
    }
    console.log(`Rolled back ${data.products.length} products.`);
    await mongoose.disconnect();
    return;
  }

  const brands = await B.find({}).project({ name: 1, slug: 1 }).toArray();
  const bySlug = new Map(brands.map((b) => [b.slug, b]));

  const plan = [];
  const missingDepartments = new Set();

  for (const [brandSlug, categories] of Object.entries(RULES)) {
    const brand = bySlug.get(brandSlug);
    if (!brand) {
      console.warn(`  ! brand not found: ${brandSlug}`);
      continue;
    }
    for (const [category, department] of Object.entries(categories)) {
      if (!(await D.findOne({ slug: department }))) {
        missingDepartments.add(department);
        continue;
      }
      const rows = await P.find({
        brand: brand._id,
        category,
        $or: [{ department: "" }, { department: null }, { department: { $exists: false } }],
      })
        .project({ _id: 1, department: 1 })
        .toArray();
      if (rows.length) {
        plan.push({ brand: brand.name, category, department, rows });
      }
    }
  }

  const total = plan.reduce((s, p) => s + p.rows.length, 0);
  const stillUnassigned = await P.countDocuments({
    $or: [{ department: "" }, { department: null }, { department: { $exists: false } }],
  });

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  const summary = {};
  plan.forEach((p) => {
    const key = `${p.brand} / ${p.category} -> ${p.department}`;
    summary[key] = p.rows.length;
  });
  console.table(summary);
  console.log(`Products to assign : ${total}`);
  console.log(`Currently unassigned: ${stillUnassigned}`);
  console.log(`Would remain        : ${stillUnassigned - total}`);
  if (missingDepartments.size) {
    console.log(
      `\n! departments not in the database: ${[...missingDepartments].join(", ")}`,
    );
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-assign-departments-${stamp}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        products: plan.flatMap((p) =>
          p.rows.map((r) => ({ _id: String(r._id), department: r.department ?? "" })),
        ),
      },
      null,
      2,
    ),
  );
  console.log(`\nRollback written: ${file}`);

  for (const p of plan) {
    await P.updateMany(
      { _id: { $in: p.rows.map((r) => r._id) } },
      { $set: { department: p.department } },
    );
  }
  console.log(`Assigned ${total} products.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

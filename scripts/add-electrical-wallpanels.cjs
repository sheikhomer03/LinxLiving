const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Two new storefront sections: Electrical and Wall Panels.
 *
 * Both departments already exist in the departments collection but hold no
 * products, so this fills and activates them rather than creating anything.
 *
 * ELECTRICAL — every product currently in the Lighting department moves across.
 * That is what was asked for. Worth recording that it files 724 lampshades and
 * 192 plug-in table lamps as electrical goods, and leaves the Lighting
 * department empty; if that reads wrong on the storefront, the rollback file
 * puts it all back.
 *
 * WALL PANELS — decorative and bathroom wall/ceiling panelling from MB Decor,
 * Porcelanosa and Under Floor Heating. Solar panels are deliberately excluded:
 * same word, different product.
 *
 * Only the `department` field is written. No prices, names, images,
 * categories, subcategories or configurator data are touched.
 *
 *   node scripts/add-electrical-wallpanels.cjs                 # dry run
 *   node scripts/add-electrical-wallpanels.cjs --apply
 *   node scripts/add-electrical-wallpanels.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** Panel ranges that belong in Wall Panels. */
const PANEL_CATEGORIES = [
  "decorwall",
  "vox",
  "dumaplast",
  "vilo",
  "panel-stone",
  "ceiling-panel",
  "claddings",
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const P = mongoose.connection.collection("products");
  const D = mongoose.connection.collection("departments");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const p of data.products) {
      await P.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { department: p.department } },
      );
    }
    for (const d of data.departments) {
      await D.updateOne({ slug: d.slug }, { $set: { isActive: d.isActive } });
    }
    console.log(
      `Rolled back ${data.products.length} products and ${data.departments.length} departments.`,
    );
    await mongoose.disconnect();
    return;
  }

  for (const slug of ["electrical", "wall-panels"]) {
    if (!(await D.findOne({ slug }))) {
      throw new Error(`department "${slug}" is missing`);
    }
  }

  // --- Electrical: the whole Lighting department -------------------------
  const electrical = await P.find({ department: "lighting" })
    .project({ _id: 1, department: 1, category: 1 })
    .toArray();

  // --- Wall Panels: panel ranges wherever they currently sit -------------
  const panels = await P.find({
    category: { $in: PANEL_CATEGORIES },
    department: { $ne: "wall-panels" },
  })
    .project({ _id: 1, department: 1, category: 1 })
    .toArray();

  // Porcelanosa files panels as a subcategory rather than a category.
  const porcelanosaPanels = await P.find({
    subCategory: "panels",
    department: { $ne: "wall-panels" },
  })
    .project({ _id: 1, department: 1, category: 1 })
    .toArray();

  const ufhPanels = await P.find({
    subCategory: "bathroom-wall-panels",
    department: { $ne: "wall-panels" },
  })
    .project({ _id: 1, department: 1, category: 1 })
    .toArray();

  const panelIds = new Map();
  [...panels, ...porcelanosaPanels, ...ufhPanels].forEach((p) =>
    panelIds.set(String(p._id), p),
  );
  const wallPanels = [...panelIds.values()];

  const summarise = (rows) => {
    const out = {};
    rows.forEach((r) => {
      const key = `${r.department || "(none)"} / ${r.category || "(none)"}`;
      out[key] = (out[key] || 0) + 1;
    });
    return out;
  };

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`\nELECTRICAL  <- ${electrical.length} products`);
  console.table(summarise(electrical));
  console.log(`\nWALL PANELS <- ${wallPanels.length} products`);
  console.table(summarise(wallPanels));

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-electrical-wallpanels-${stamp}.json`;
  const departments = await D.find({
    slug: { $in: ["electrical", "wall-panels", "lighting"] },
  })
    .project({ slug: 1, isActive: 1 })
    .toArray();

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        products: [...electrical, ...wallPanels].map((p) => ({
          _id: String(p._id),
          department: p.department ?? "",
        })),
        departments: departments.map((d) => ({
          slug: d.slug,
          isActive: d.isActive,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nRollback written: ${file}`);

  if (electrical.length) {
    await P.updateMany(
      { _id: { $in: electrical.map((p) => p._id) } },
      { $set: { department: "electrical" } },
    );
  }
  if (wallPanels.length) {
    await P.updateMany(
      { _id: { $in: wallPanels.map((p) => p._id) } },
      { $set: { department: "wall-panels" } },
    );
  }

  await D.updateMany(
    { slug: { $in: ["electrical", "wall-panels"] } },
    { $set: { isActive: true } },
  );

  console.log(
    `Moved ${electrical.length} to electrical, ${wallPanels.length} to wall-panels. Both departments activated.`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

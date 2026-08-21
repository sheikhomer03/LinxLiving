const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Final organisation pass for the mega menu.
 *
 *  1. Every brand's accessory ranges move into the Accessories section —
 *     including FAKRO's blinds-accessories, as instructed.
 *  2. Departments that hold products but are switched off get activated
 *     (Windows & Doors has 147 products no customer can currently reach).
 *  3. Departments holding nothing are switched off so the navbar stops
 *     showing empty tabs.
 *  4. The last few products with no department are placed.
 *
 * Only `department` on products and `isActive` on departments are written.
 * No prices, names, images, categories, subcategories, variants, sizes or
 * configurator fields are touched.
 *
 *   node scripts/organise-menu-sections.cjs                 # dry run
 *   node scripts/organise-menu-sections.cjs --apply
 *   node scripts/organise-menu-sections.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** Accessory ranges to consolidate: brand slug → category slugs. */
const ACCESSORY_MOVES = {
  fakro: ["blinds-accessories"],
  noken: ["accessories", "installation-systems"],
  porcelanosagrupo: ["installation-materials"],
  sterlingbuild: ["flashings", "accessories"],
  "mb-decor": ["mb-accessories"],
  spectra: ["adhesive-grout-silicone"],
  likewisefloors: ["accessories"],
  "direct-flooring-online": ["accessories", "laminate-flooring-accessories"],
  ukbifolddoorfactory: ["accessories"],
};

/** Remaining products with no department, by brand. */
const ORPHAN_FALLBACK = { ukbifolddoorfactory: "windows-and-doors" };

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
    for (const d of data.departments) {
      await D.updateOne({ slug: d.slug }, { $set: { isActive: d.isActive } });
    }
    console.log(
      `Rolled back ${data.products.length} products and ${data.departments.length} departments.`,
    );
    await mongoose.disconnect();
    return;
  }

  const brands = await B.find({}).project({ name: 1, slug: 1 }).toArray();
  const bySlug = new Map(brands.map((b) => [b.slug, b]));

  // --- 1. accessory consolidation ----------------------------------------
  const accessoryPlan = [];
  for (const [brandSlug, categories] of Object.entries(ACCESSORY_MOVES)) {
    const brand = bySlug.get(brandSlug);
    if (!brand) {
      console.warn(`  ! brand not found: ${brandSlug}`);
      continue;
    }
    const rows = await P.find({
      brand: brand._id,
      category: { $in: categories },
      department: { $ne: "accessories" },
    })
      .project({ _id: 1, department: 1, category: 1, price: 1 })
      .toArray();
    if (rows.length) accessoryPlan.push({ brand: brand.name, rows });
  }

  // --- 2. orphans ---------------------------------------------------------
  const orphanPlan = [];
  for (const [brandSlug, department] of Object.entries(ORPHAN_FALLBACK)) {
    const brand = bySlug.get(brandSlug);
    if (!brand) continue;
    const rows = await P.find({
      brand: brand._id,
      $or: [{ department: "" }, { department: null }, { department: { $exists: false } }],
    })
      .project({ _id: 1, department: 1 })
      .toArray();
    if (rows.length) orphanPlan.push({ brand: brand.name, department, rows });
  }

  // --- 3. department activation ------------------------------------------
  // Counted on PRICED products only: the storefront hides unpriced lines
  // (SHOW_ONLY_PRICED_PRODUCTS), so a department full of unpriced stock still
  // renders an empty tab. Kitchens has 45 products and not one price.
  const counts = await P.aggregate([
    { $match: { price: { $gt: 0 } } },
    { $group: { _id: { $ifNull: ["$department", ""] }, n: { $sum: 1 } } },
  ]).toArray();
  const productCount = new Map(counts.map((c) => [c._id, c.n]));

  // Accessory moves change the totals, so work them in before deciding.
  const movingOut = new Map();
  accessoryPlan.forEach((p) =>
    p.rows.forEach((r) => {
      if (!(r.price > 0)) return;
      const d = r.department || "";
      movingOut.set(d, (movingOut.get(d) || 0) + 1);
    }),
  );

  const departments = await D.find({}).project({ slug: 1, name: 1, isActive: 1 }).toArray();
  const toActivate = [];
  const toDeactivate = [];
  for (const d of departments) {
    const after = (productCount.get(d.slug) || 0) - (movingOut.get(d.slug) || 0);
    const active = d.isActive !== false;
    if (after > 0 && !active) toActivate.push({ ...d, after });
    if (after === 0 && active) toDeactivate.push({ ...d, after });
  }

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  const accSummary = {};
  accessoryPlan.forEach((p) => {
    p.rows.forEach((r) => {
      const key = `${p.brand} / ${r.category} (${r.department || "none"})`;
      accSummary[key] = (accSummary[key] || 0) + 1;
    });
  });
  console.log("\n1. ACCESSORIES CONSOLIDATION");
  console.table(accSummary);
  const accTotal = accessoryPlan.reduce((s, p) => s + p.rows.length, 0);
  console.log(`   total moving to accessories: ${accTotal}`);

  console.log("\n2. ORPHANS PLACED");
  orphanPlan.forEach((p) =>
    console.log(`   ${p.brand} -> ${p.department}: ${p.rows.length}`),
  );

  console.log("\n3. DEPARTMENTS TO ACTIVATE (have priced products, tab hidden)");
  toActivate.forEach((d) => console.log(`   ${d.slug.padEnd(26)} ${d.after} priced`));

  console.log("\n4. DEPARTMENTS TO HIDE (nothing a shopper can see)");
  toDeactivate.forEach((d) => console.log(`   ${d.slug}`));

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-organise-menu-${stamp}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        products: [
          ...accessoryPlan.flatMap((p) => p.rows),
          ...orphanPlan.flatMap((p) => p.rows),
        ].map((r) => ({ _id: String(r._id), department: r.department ?? "" })),
        departments: [...toActivate, ...toDeactivate].map((d) => ({
          slug: d.slug,
          isActive: d.isActive,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nRollback written: ${file}`);

  for (const p of accessoryPlan) {
    await P.updateMany(
      { _id: { $in: p.rows.map((r) => r._id) } },
      { $set: { department: "accessories" } },
    );
  }
  for (const p of orphanPlan) {
    await P.updateMany(
      { _id: { $in: p.rows.map((r) => r._id) } },
      { $set: { department: p.department } },
    );
  }
  if (toActivate.length) {
    await D.updateMany(
      { slug: { $in: toActivate.map((d) => d.slug) } },
      { $set: { isActive: true } },
    );
  }
  if (toDeactivate.length) {
    await D.updateMany(
      { slug: { $in: toDeactivate.map((d) => d.slug) } },
      { $set: { isActive: false } },
    );
  }

  console.log(
    `Done: ${accTotal} to accessories, ${orphanPlan.reduce((s, p) => s + p.rows.length, 0)} orphans placed, ${toActivate.length} departments activated, ${toDeactivate.length} hidden.`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

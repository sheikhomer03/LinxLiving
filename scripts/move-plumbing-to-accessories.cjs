const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Fold Plumbing into Accessories.
 *
 * Moves the products and the category menu record, then hides the Plumbing
 * tab — leaving it active would render a department with nothing behind it.
 *
 * Both halves matter: the navbar builds its tabs from the `menus` collection,
 * so moving products alone would leave an Accessories tab that does not list
 * the plumbing range.
 *
 * Writes only `department` on products and menus, and `isActive` on the
 * Plumbing department. No prices, names, images, categories, subcategories or
 * configurator data are touched.
 *
 *   node scripts/move-plumbing-to-accessories.cjs                 # dry run
 *   node scripts/move-plumbing-to-accessories.cjs --apply
 *   node scripts/move-plumbing-to-accessories.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

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
    for (const d of data.departments) {
      await D.updateOne({ slug: d.slug }, { $set: { isActive: d.isActive } });
    }
    console.log(
      `Rolled back ${data.products.length} products, ${data.menus.length} menus, ${data.departments.length} departments.`,
    );
    await mongoose.disconnect();
    return;
  }

  const accessories = await D.findOne({ slug: "accessories" });
  const plumbing = await D.findOne({ slug: "plumbing" });
  if (!accessories) throw new Error("accessories department missing");
  if (!plumbing) throw new Error("plumbing department missing");

  const products = await P.find({ department: "plumbing" })
    .project({ _id: 1, department: 1, category: 1 })
    .toArray();
  const menus = await M.find({ department: plumbing._id })
    .project({ _id: 1, name: 1, slug: 1, department: 1 })
    .toArray();

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  const byCategory = {};
  products.forEach((p) => {
    byCategory[p.category || "(none)"] = (byCategory[p.category || "(none)"] || 0) + 1;
  });
  console.table(byCategory);
  console.log(`Products moving to accessories : ${products.length}`);
  console.log(
    `Menu records moving            : ${menus.length} (${menus.map((m) => m.slug).join(", ")})`,
  );
  console.log(`Plumbing tab                   : will be hidden`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-plumbing-to-accessories-${stamp}.json`;
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
        departments: [{ slug: "plumbing", isActive: plumbing.isActive }],
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
  await D.updateOne({ slug: "plumbing" }, { $set: { isActive: false } });

  console.log(
    `Moved ${products.length} products and ${menus.length} menu records to Accessories. Plumbing tab hidden.`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

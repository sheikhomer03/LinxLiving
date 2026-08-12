const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Bathroom tiles belong under Tiles, not Bathrooms.
 *
 * The Under Floor Heating files its tile range as a `tiles` subcategory of
 * its `bathrooms` category, so it surfaced under the Bathrooms tab. Someone
 * shopping for tiles looks under Tiles, whichever room they are for.
 *
 * Moves the products and the menu record, since the navbar builds its tabs
 * from the `menus` collection rather than from products.
 *
 * Writes only `department` on products and menus. No prices, names, images,
 * categories, subcategories or configurator data are touched.
 *
 *   node scripts/move-bathroom-tiles.cjs                 # dry run
 *   node scripts/move-bathroom-tiles.cjs --apply
 *   node scripts/move-bathroom-tiles.cjs --rollback <file.json>
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

  const tiles = await D.findOne({ slug: "tiles" });
  if (!tiles) throw new Error("tiles department missing");

  const products = await P.find({
    department: "bathrooms",
    subCategory: "tiles",
  })
    .project({ _id: 1, name: 1, department: 1 })
    .toArray();

  // The menu record sits as a child of the brand's `bathrooms` menu, so it
  // inherits Bathrooms. Re-point it at Tiles as a top-level entry.
  const menus = await M.find({ slug: "tiles" })
    .project({ _id: 1, slug: 1, parent: 1, department: 1 })
    .toArray();
  const menuPlan = menus.filter(
    (m) => String(m.department || "") !== String(tiles._id),
  );

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`\nPRODUCTS moving to Tiles: ${products.length}`);
  products.slice(0, 8).forEach((p) => console.log(`   ${String(p.name).slice(0, 66)}`));
  if (products.length > 8) console.log(`   … +${products.length - 8} more`);
  console.log(`\nMENU records to re-point: ${menuPlan.length}`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-bathroom-tiles-${stamp}.json`;
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
          parent: m.parent ? String(m.parent) : null,
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
      { $set: { department: "tiles" } },
    );
  }
  for (const m of menuPlan) {
    await M.updateOne(
      { _id: m._id },
      { $set: { department: tiles._id, parent: null } },
    );
  }
  console.log(
    `Moved ${products.length} products and ${menuPlan.length} menu records to Tiles.`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

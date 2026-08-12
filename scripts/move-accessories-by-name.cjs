const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Accessories that only reveal themselves in the product name.
 *
 * Some ranges mix fitting parts in with the product itself — MB Decor's
 * Extruda decking sits in one `mb-outdoor` category containing both composite
 * boards and the clips, screws, joists and corner profiles used to lay them.
 * There is no accessory category or subcategory to move, so these have to be
 * matched on the name.
 *
 * Deliberately narrow: it runs only on the departments listed in SCOPE, and
 * only on unambiguous fitting words. Board, panel, post and rail products are
 * left alone. Always read the dry run before applying — a name rule is
 * blunter than a category rule and deserves the extra look.
 *
 * Writes only `department` on products. No prices, names, images, categories,
 * subcategories or configurator data are touched.
 *
 *   node scripts/move-accessories-by-name.cjs                 # dry run
 *   node scripts/move-accessories-by-name.cjs --apply
 *   node scripts/move-accessories-by-name.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/**
 * Departments this rule is allowed to touch.
 *
 * Lighting and Electrical are deliberately excluded: a lampshade is a
 * "clip on shade", a bulb has an "E27 screw fitting" and a spotlight sits on
 * an "adjustable bracket" — every one a product, not a fitting part. A name
 * rule cannot tell them apart, so it does not get to try.
 */
const SCOPE = [
  "outdoor-living",
  "rooflights-and-glass",
  "roofing",
  "wall-panels",
  "tiles",
  "heating",
  "flooring",
];

/**
 * Fitting parts. "Angle" and "profile" are trims; "joist" is the sub-frame;
 * clips, screws and fasteners are self-evident. Boards, panels, posts and
 * rails are the products themselves and never match.
 */
const ACCESSORY_NAME =
  /\b(clips?|fixings?|screws?|fasteners?|brackets?|joists?|rigid angle|corner profile|starter|end cap|fence cap|flashing|trim|adhesive|grout|sealant|primer|underlay|spacer|batten|glue)\b/i;

/**
 * Products that match the rule but are not accessories.
 *
 * "Glue down" is an LVT fitting method, not glue. A rooflight sold "with
 * flashing kit" is still a rooflight. Checked first, so these always win.
 */
const NOT_ACCESSORY =
  /glue[- ]down|rooflight with|window with|\bwith .{0,20}flashing kit/i;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const P = mongoose.connection.collection("products");

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

  const rows = await P.find({ department: { $in: SCOPE } })
    .project({ _id: 1, name: 1, department: 1 })
    .toArray();
  const isAccessory = (name) =>
    ACCESSORY_NAME.test(String(name || "")) &&
    !NOT_ACCESSORY.test(String(name || ""));
  const moving = rows.filter((r) => isAccessory(r.name));
  const staying = rows.filter((r) => !isAccessory(r.name));

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`\nMOVING TO ACCESSORIES (${moving.length})`);
  moving.forEach((r) => console.log(`   ${String(r.name).slice(0, 72)}`));
  console.log(`\nSTAYING (${staying.length})`);
  staying.forEach((r) => console.log(`   ${String(r.name).slice(0, 72)}`));

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-accessories-by-name-${stamp}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        products: moving.map((r) => ({
          _id: String(r._id),
          department: r.department ?? "",
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nRollback written: ${file}`);

  if (moving.length) {
    await P.updateMany(
      { _id: { $in: moving.map((r) => r._id) } },
      { $set: { department: "accessories" } },
    );
  }
  console.log(`Moved ${moving.length} products to Accessories.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

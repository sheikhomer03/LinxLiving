/**
 * Give Britmet a home: a "Roofing" department.
 *
 * Britmet's 173 products are all priced but carry no department, and none of
 * their 15 menus are linked to one — so the brand can only be reached through
 * the Brands tab and never appears in a department panel.
 *
 * Roofing rather than an existing department because:
 *   - Rooflights & Glass: only 4 of 173 are rooflights; the rest are roof
 *     sheets, tile-effect panels, flashings, fixings and paint.
 *   - Tiles: these are ROOF tiles, deliberately excluded from the wall/floor
 *     Tiles department during the earlier migration.
 *   - Building Materials: a catch-all that hides what the range actually is.
 *
 * Nothing is deleted. The previous department of every touched product and
 * menu is written to a rollback file.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/place-britmet-roofing.cjs           # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/place-britmet-roofing.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/place-britmet-roofing.cjs --rollback <file>
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const APPLY = process.argv.includes("--apply");
const ROLLBACK_IDX = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX > -1 ? process.argv[ROLLBACK_IDX + 1] : null;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");
  const Departments = mongoose.connection.collection("departments");
  const Menus = mongoose.connection.collection("menus");
  const Brands = mongoose.connection.collection("brands");

  if (ROLLBACK_FILE) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    for (const p of data.products || []) {
      await Products.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { department: p.department } },
      );
    }
    for (const m of data.menus || []) {
      await Menus.updateOne(
        { _id: new mongoose.Types.ObjectId(m._id) },
        { $set: { department: m.department ? new mongoose.Types.ObjectId(m.department) : null } },
      );
    }
    console.log(
      `Rolled back ${(data.products || []).length} products and ${(data.menus || []).length} menus.`,
    );
    await mongoose.disconnect();
    return;
  }

  const brand = await Brands.findOne({ slug: "britmet" });
  if (!brand) throw new Error("Britmet brand not found");

  const products = await Products.find({ brand: brand._id })
    .project({ _id: 1, department: 1, category: 1 })
    .toArray();
  const menus = await Menus.find({ brand: brand._id })
    .project({ _id: 1, slug: 1, department: 1 })
    .toArray();

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`Britmet products : ${products.length}`);
  console.log(`Britmet menus    : ${menus.length}`);

  let dept = await Departments.findOne({ slug: "roofing" });
  console.log(`Roofing department: ${dept ? "already exists" : "will be CREATED"}`);

  if (!APPLY) {
    console.log("\nWould set department 'roofing' on all of the above.");
    console.log("Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  if (!dept) {
    const rooflights = await Departments.findOne({ slug: "rooflights-and-glass" });
    const res = await Departments.insertOne({
      name: "Roofing",
      slug: "roofing",
      description:
        "Lightweight roofing systems, roof sheets, flashings and fixings.",
      order: (rooflights?.order ?? 2) + 1,
      isActive: true,
      image: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    dept = await Departments.findOne({ _id: res.insertedId });
  } else {
    await Departments.updateOne(
      { _id: dept._id },
      { $set: { isActive: true, updatedAt: new Date() } },
    );
  }

  const backup = {
    products: products.map((p) => ({ _id: String(p._id), department: p.department ?? "" })),
    menus: menus.map((m) => ({ _id: String(m._id), department: m.department ? String(m.department) : null })),
  };
  const file = path.join(process.cwd(), "rollback-britmet-roofing.json");
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRollback file: ${path.basename(file)}`);

  const pRes = await Products.updateMany(
    { brand: brand._id },
    { $set: { department: "roofing" } },
  );
  const mRes = await Menus.updateMany(
    { brand: brand._id },
    { $set: { department: dept._id, updatedAt: new Date() } },
  );

  console.log(`Products updated : ${pRes.modifiedCount}`);
  console.log(`Menus linked     : ${mRes.modifiedCount}`);
  console.log(
    `\nTo undo: node --require ./scripts/mongo-dns.cjs scripts/place-britmet-roofing.cjs --rollback ${path.basename(file)}`,
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

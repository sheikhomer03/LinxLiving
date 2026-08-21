/**
 * Plank Hardware's switch range is filed as cabinet hardware.
 *
 * 159 light switches, dimmers and sockets sit under
 * accessories / all-cabinet-hardware, so they list beside knobs and handles
 * and never appear under Electrical → Switches & sockets. `living-room-hardware`
 * is 137 of 137 switches; the other two subcategories are mixed, so selection
 * is by name as well and the hooks and wall lights in them stay put.
 *
 * Moves department + category only. subCategory is left alone so the ALVA /
 * BOBBIN collections stay grouped and the change stays easy to read back.
 *
 * Usage:
 *   node scripts/move-plank-switches-to-electrical.cjs            # dry run
 *   node scripts/move-plank-switches-to-electrical.cjs --apply    # write
 */
const fs = require("fs");
const path = require("path");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const SWITCH_NAME =
  /\b(switch|switches|dimmer|socket|sockets|toggle|fused spur|usb|module)\b/i;

const FROM = { department: "accessories", category: "all-cabinet-hardware" };
const SUBS = ["living-room-hardware", "alva-collection", "nursery-hardware"];
const TO = { department: "electrical", category: "light-switches-sockets" };

(async () => {
  const conn = await connectMongo();
  const db = conn.db;

  const query = { ...FROM, subCategory: { $in: SUBS }, name: SWITCH_NAME };
  const docs = await db
    .collection("products")
    .find(query)
    .project({ name: 1, department: 1, category: 1, subCategory: 1 })
    .toArray();

  const bySub = {};
  docs.forEach((d) => {
    bySub[d.subCategory] = (bySub[d.subCategory] || 0) + 1;
  });

  console.log(`${docs.length} products would move`);
  console.log(`  from  ${FROM.department} / ${FROM.category}`);
  console.log(`  to    ${TO.department} / ${TO.category}   (subCategory kept)\n`);
  Object.entries(bySub).forEach(([k, n]) =>
    console.log(`   ${String(n).padStart(4)}  ${k}`),
  );

  // What stays behind, so the exclusions are visible rather than implied.
  const staying = await db
    .collection("products")
    .find({ ...FROM, subCategory: { $in: SUBS }, name: { $not: SWITCH_NAME } })
    .project({ name: 1, subCategory: 1 })
    .toArray();
  console.log(`\n${staying.length} left in place (not switches):`);
  staying.forEach((p) =>
    console.log(`   [${p.subCategory}] ${String(p.name).slice(0, 56)}`),
  );

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to commit.");
    await conn.close();
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackFile = path.join(
    __dirname,
    "..",
    `rollback-plank-switches-${stamp}.json`,
  );
  fs.writeFileSync(
    rollbackFile,
    JSON.stringify(
      docs.map((d) => ({
        _id: String(d._id),
        department: d.department,
        category: d.category,
        subCategory: d.subCategory,
      })),
      null,
      2,
    ),
  );
  console.log(`\nrollback written: ${rollbackFile}`);

  const res = await db.collection("products").updateMany(
    { _id: { $in: docs.map((d) => d._id) } },
    { $set: { department: TO.department, category: TO.category } },
  );
  console.log(`updated: ${res.modifiedCount}`);

  await conn.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

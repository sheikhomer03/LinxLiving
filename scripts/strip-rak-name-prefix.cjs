/**
 * Remove the "RAK-" brand prefix from RAK CERAMICS product names — at the start
 * of the name and anywhere inside it ("Basin Stand, for RAK-Valet 119cm").
 *
 * Only the hyphen/underscore forms are stripped ("RAK-", "RAK- ", "Rak-").
 * A bare "RAK " is left alone: mid-name it is the material ("RAK Solid White"),
 * so blanket-stripping it would corrupt the spec.
 *
 * Dry run by default; pass --apply to write. Every write is journalled to a
 * rollback-rak-name-prefix-<stamp>.json in the repo root.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
// --bare-leading also drops a leading "RAK " with no hyphen ("RAK 350mm Wall
// Arm"). Leading only, and never when "Solid" follows: mid-name "RAK Solid" is
// the material, not the brand, and must survive.
const BARE = process.argv.includes("--bare-leading");
const RAK_PREFIX = /\bRAK\s*[-_]\s*/gi;
const BARE_LEADING = /^RAK\s+(?!Solid\b)/i;

function cleanName(name) {
  let out = String(name || "").replace(RAK_PREFIX, "");
  if (BARE) out = out.replace(BARE_LEADING, "");
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .trim();
}

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;

  const brand = await db.collection("brands").findOne({ slug: "rak-ceramics" });
  if (!brand) {
    console.error("Brand rak-ceramics not found");
    process.exit(1);
  }

  const products = await db
    .collection("products")
    .find({
      brand: brand._id,
      $or: [
        { name: /\brak\s*[-_]/i },
        ...(BARE ? [{ name: /^RAK\s+/i }] : []),
      ],
    })
    .project({ name: 1 })
    .toArray();

  const changes = [];
  const skipped = [];
  for (const p of products) {
    const after = cleanName(p.name);
    if (!after) {
      skipped.push({ _id: String(p._id), name: p.name, why: "empty after strip" });
      continue;
    }
    if (after === p.name) continue;
    changes.push({ _id: p._id, before: p.name, after });
  }

  console.log(`matched products : ${products.length}`);
  console.log(`to change        : ${changes.length}`);
  console.log(`skipped          : ${skipped.length}`);
  skipped.forEach((s) => console.log(`   SKIP ${s._id}: "${s.name}" (${s.why})`));

  console.log("\n-- first 20 before -> after --");
  for (const c of changes.slice(0, 20)) {
    console.log(`  "${c.before}"\n     -> "${c.after}"`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to commit.");
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackPath = path.join(
    __dirname,
    "..",
    `rollback-rak-name-prefix-${BARE ? "bare-" : ""}${stamp}.json`,
  );
  fs.writeFileSync(
    rollbackPath,
    JSON.stringify(
      changes.map((c) => ({ _id: String(c._id), name: c.before })),
      null,
      2,
    ),
  );
  console.log(`\nrollback written: ${rollbackPath}`);

  const ops = changes.map((c) => ({
    updateOne: {
      filter: { _id: c._id },
      // shopifySyncedAt is cleared so the next push re-sends the title.
      update: { $set: { name: c.after, updatedAt: new Date(), shopifySyncedAt: null } },
    },
  }));

  let modified = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const res = await db.collection("products").bulkWrite(ops.slice(i, i + 500), { ordered: false });
    modified += res.modifiedCount;
    console.log(`  batch ${i / 500 + 1}: ${res.modifiedCount} modified`);
  }

  const left = await db
    .collection("products")
    .countDocuments({ brand: brand._id, name: /\brak\s*[-_]/i });
  console.log(`\nmodified: ${modified}`);
  console.log(`names still containing "RAK-": ${left}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

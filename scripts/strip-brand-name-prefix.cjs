/**
 * Remove a brand's own name from its product names.
 *
 * Generalised from strip-rak-name-prefix.cjs, which was written for RAK's messy
 * "RAK-" / "RAK- " / "Rak-" variants. Usage:
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/strip-brand-name-prefix.cjs \
 *     --brand=fakro --token=FAKRO            # dry run
 *   ... --apply                              # commit
 *
 * By default only a *leading* occurrence is stripped. Pass --mid to strip the
 * token anywhere in the name (RAK needed that for "Basin Stand, for RAK-Valet").
 *
 * `--keep` protects a word that follows the token: RAK needed `--keep=Solid`
 * because "RAK Solid White" is a material, not the brand. Matching is on whole
 * words, so a product named "Krakow" is never touched.
 *
 * Every write is journalled to rollback-<brand>-name-prefix-<stamp>.json.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { connectMongo } = require("./mongo-connect.cjs");

const arg = (name, fallback = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY = process.argv.includes("--apply");
const MID = process.argv.includes("--mid");
const BRAND = arg("brand");
const TOKEN = arg("token");
const KEEP = arg("keep")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!BRAND || !TOKEN) {
  console.error("Usage: --brand=<slug> --token=<WORD> [--mid] [--keep=A,B] [--apply]");
  process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The token, then any run of separator characters (space, hyphen, underscore).
// `(?!keep)` protects a following word that belongs to the product, not the brand.
const guard = KEEP.length ? `(?!(?:${KEEP.map(esc).join("|")})\\b)` : "";
const LEADING = new RegExp(`^${esc(TOKEN)}\\b[\\s\\-_]+${guard}`, "i");
const ANYWHERE = new RegExp(`\\b${esc(TOKEN)}\\b[\\s\\-_]+${guard}`, "gi");

function cleanName(name) {
  let out = String(name || "");
  out = MID ? out.replace(ANYWHERE, "") : out.replace(LEADING, "");
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .trim();
}

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;

  const brand = await db.collection("brands").findOne({ slug: BRAND });
  if (!brand) {
    console.error(`Brand ${BRAND} not found`);
    process.exit(1);
  }

  const products = await db
    .collection("products")
    .find({ brand: brand._id, name: new RegExp(`\\b${esc(TOKEN)}\\b`, "i") })
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

  console.log(`brand            : ${brand.name} (${BRAND})`);
  console.log(`mode             : ${MID ? "leading + mid-name" : "leading only"}`);
  console.log(`matched products : ${products.length}`);
  console.log(`to change        : ${changes.length}`);
  console.log(`skipped          : ${skipped.length}`);
  skipped.forEach((s) => console.log(`   SKIP ${s._id}: "${s.name}" (${s.why})`));

  console.log("\n-- first 15 before -> after --");
  for (const c of changes.slice(0, 15)) {
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
    `rollback-${BRAND}-name-prefix-${stamp}.json`,
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
      update: {
        $set: { name: c.after, updatedAt: new Date(), shopifySyncedAt: null },
      },
    },
  }));

  let modified = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const res = await db
      .collection("products")
      .bulkWrite(ops.slice(i, i + 500), { ordered: false });
    modified += res.modifiedCount;
    console.log(`  batch ${i / 500 + 1}: ${res.modifiedCount} modified`);
  }

  const left = await db
    .collection("products")
    .countDocuments({ brand: brand._id, name: LEADING });
  console.log(`\nmodified: ${modified}`);
  console.log(`names still starting with "${TOKEN}": ${left}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Fill `Product.categories[]` — every main category a product belongs to.
 *
 * The importer can record only one `category` per product, so a supplier that
 * cross-lists (Plank files the same knob under Knobs, a finish, a room and a
 * design collection) loses everything but the first. The full sub-category
 * membership already survives in `subCategories[]`; this walks that array up
 * the menu tree and stores the mains it resolves to.
 *
 * Nothing is moved: `category` and `subCategory` keep their current values and
 * stay the primaries. This only adds the memberships that were dropped, so
 * Taps, Hooks & Accessories and By Finish stop resolving to zero products.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-product-categories.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-product-categories.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-product-categories.cjs --rollback <file.json>
 *
 *   BRAND=plankhardware   limit to one brand (default: every brand that uses
 *                         subCategories[]; today that is Plank alone)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const sameSet = (a, b) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

async function main() {
  await connectMongo();
  const db = mongoose.connection.db;
  const products = db.collection("products");

  if (ROLLBACK) {
    const saved = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const r of saved.changes) {
      await products.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        { $set: { categories: r.before } },
      );
    }
    console.log(`rolled back ${saved.changes.length} products from ${ROLLBACK}`);
    await mongoose.disconnect();
    return;
  }

  /**
   * slug -> every main it hangs under. A slug can have more than one parent:
   * Plank lists the eight finishes under both Knobs & Handles and the By
   * Finish hub, and a product in one is genuinely in both.
   */
  const menus = await db.collection("menus").find({}).toArray();
  const mains = new Map(
    menus.filter((m) => !m.parent).map((m) => [String(m._id), m.slug]),
  );
  const parentsOf = new Map();
  for (const m of menus) {
    if (!m.parent) continue;
    const main = mains.get(String(m.parent));
    if (!main) continue; // child of a child — its own parent resolves instead
    if (!parentsOf.has(m.slug)) parentsOf.set(m.slug, new Set());
    parentsOf.get(m.slug).add(main);
  }
  const mainSlugs = new Set(mains.values());

  const filter = { "subCategories.0": { $exists: true } };
  if (process.env.BRAND) {
    const b = await db
      .collection("brands")
      .findOne({ slug: process.env.BRAND.toLowerCase() });
    if (!b) throw new Error(`brand not found: ${process.env.BRAND}`);
    filter.$or = [{ brand: b._id }, { brands: b._id }];
  }

  const docs = await products
    .find(filter)
    .project({ name: 1, category: 1, subCategory: 1, subCategories: 1, categories: 1 })
    .toArray();

  const changes = [];
  const tally = new Map();
  const orphans = [];

  for (const p of docs) {
    const set = new Set();
    // The primary still counts as a membership when it names a real main.
    if (p.category && mainSlugs.has(p.category)) set.add(p.category);
    for (const s of p.subCategories || [])
      for (const main of parentsOf.get(s) || []) set.add(main);
    for (const main of parentsOf.get(p.subCategory) || []) set.add(main);

    const after = [...set].sort();
    if (!after.length) {
      orphans.push(p);
      continue;
    }
    for (const s of after) tally.set(s, (tally.get(s) || 0) + 1);

    const before = [...(p.categories || [])].sort();
    if (sameSet(before, after)) continue;
    changes.push({ _id: String(p._id), name: p.name, before: p.categories || [], after });
  }

  console.log(`products carrying subCategories[]: ${docs.length}`);
  console.log(`to update: ${changes.length}\n`);
  console.log("membership per main after backfill (all products, priced or not):");
  for (const [slug, n] of [...tally].sort((a, b) => b[1] - a[1]))
    console.log(`   ${String(n).padStart(4)}  ${slug}`);

  if (orphans.length) {
    console.log(`\nno main resolved (left untouched): ${orphans.length}`);
    for (const o of orphans.slice(0, 10))
      console.log(`   "${o.name}"  category="${o.category || ""}"`);
  }

  const sample = changes.slice(0, 5);
  if (sample.length) {
    console.log(`\nsample:`);
    for (const c of sample)
      console.log(`   "${c.name.slice(0, 44)}"  [${c.before.join(", ")}] -> [${c.after.join(", ")}]`);
  }

  if (!APPLY) {
    console.log("\ndry run — pass --apply to write");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-product-categories-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ changes }, null, 2));

  let done = 0;
  const BATCH = 200;
  for (let i = 0; i < changes.length; i += BATCH) {
    const ops = changes.slice(i, i + BATCH).map((c) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(c._id) },
        update: { $set: { categories: c.after } },
      },
    }));
    const r = await products.bulkWrite(ops, { ordered: false });
    done += r.modifiedCount || 0;
  }
  console.log(`\napplied ${done} updates; rollback -> ${file}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

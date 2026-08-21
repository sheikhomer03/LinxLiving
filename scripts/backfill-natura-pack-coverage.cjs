const fs = require("fs");
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const mongoose = require("mongoose");

/**
 * Give Natura Flooring products their pack coverage.
 *
 * Engineered wood is sold by the pack, not the square metre — naturaflooring
 * .co.uk rounds an order up to whole packs, so asking for 1m² of a 2.614m²
 * pack charges for the pack. Our calculator had no pack size to work with and
 * charged pro-rata, so 1m² came out at one m² of the rate instead of a pack.
 *
 * `specs.sqmPerBox` is derived from the two figures already stored:
 *
 *     price (pack, inc. VAT)  ÷  specs.pricePerM2  =  m² per pack
 *
 * The results are clean pack sizes (4.005, 2.614, 1.79, 0.924, 0.9, 2.156,
 * 1.98), which is what you would expect if both figures came from the same
 * source page — so this is recovering a value that was dropped on import
 * rather than inventing one.
 *
 * Writes only `specs.sqmPerBox`. No prices, names, images, categories or
 * departments are touched.
 *
 *   node scripts/backfill-natura-pack-coverage.cjs                 # dry run
 *   node scripts/backfill-natura-pack-coverage.cjs --apply
 *   node scripts/backfill-natura-pack-coverage.cjs --rollback <file.json>
 */

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** Reject nonsense: a flooring pack is not 0.05m² and not 40m². */
const MIN_PACK_M2 = 0.5;
const MAX_PACK_M2 = 12;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const P = mongoose.connection.collection("products");
  const B = mongoose.connection.collection("brands");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const p of data.products) {
      if (p.sqmPerBox == null) {
        await P.updateOne(
          { _id: new mongoose.Types.ObjectId(p._id) },
          { $unset: { "specs.sqmPerBox": "" } },
        );
      } else {
        await P.updateOne(
          { _id: new mongoose.Types.ObjectId(p._id) },
          { $set: { "specs.sqmPerBox": p.sqmPerBox } },
        );
      }
    }
    console.log(`Rolled back ${data.products.length} products.`);
    await mongoose.disconnect();
    return;
  }

  const brand = await B.findOne({ slug: "natura-flooring" });
  if (!brand) throw new Error("natura-flooring brand missing");

  const rows = await P.find({ brand: brand._id, price: { $gt: 0 } })
    .project({ _id: 1, name: 1, price: 1, specs: 1 })
    .toArray();

  const plan = [];
  const skipped = [];
  for (const r of rows) {
    const specs = r.specs || {};
    const perM2 = Number(specs.pricePerM2);
    const existing = specs.sqmPerBox ?? specs.sqmperbox;
    if (existing != null) {
      skipped.push([r.name, `already has ${existing}`]);
      continue;
    }
    if (!Number.isFinite(perM2) || perM2 <= 0) {
      skipped.push([r.name, "no pricePerM2"]);
      continue;
    }
    const packs = Math.round((Number(r.price) / perM2) * 1000) / 1000;
    if (!Number.isFinite(packs) || packs < MIN_PACK_M2 || packs > MAX_PACK_M2) {
      skipped.push([r.name, `derived ${packs} out of range`]);
      continue;
    }
    plan.push({ _id: r._id, name: r.name, packs, previous: existing ?? null });
  }

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  const bySize = {};
  plan.forEach((p) => {
    bySize[`${p.packs} m² per pack`] = (bySize[`${p.packs} m² per pack`] || 0) + 1;
  });
  console.table(bySize);
  console.log(`Products to update : ${plan.length}`);
  console.log(`Skipped            : ${skipped.length}`);
  skipped.forEach(([n, why]) => console.log(`   ${String(n).slice(0, 46)} — ${why}`));

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `rollback-natura-pack-coverage-${stamp}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        products: plan.map((p) => ({
          _id: String(p._id),
          sqmPerBox: p.previous,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nRollback written: ${file}`);

  for (const p of plan) {
    await P.updateOne(
      { _id: p._id },
      { $set: { "specs.sqmPerBox": String(p.packs) } },
    );
  }
  console.log(`Updated ${plan.length} products.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

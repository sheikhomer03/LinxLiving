/**
 * Apply a 10% price increase to Direct Flooring Online products.
 *
 * A percentage uplift is not naturally idempotent — running it twice would
 * compound to 21%. To prevent that, the pre-uplift price is recorded on the
 * product as `specs.listPriceBeforeUplift`, and any product already carrying
 * it is skipped. Re-running is therefore safe.
 *
 * Nothing is deleted. Previous prices go to a rollback file.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/uplift-direct-flooring.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/uplift-direct-flooring.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/uplift-direct-flooring.cjs --rollback <file>
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

const BRAND_SLUG = "direct-flooring-online";
const UPLIFT_PERCENT = 10;

const uplift = (price) =>
  Math.round(Number(price) * (1 + UPLIFT_PERCENT / 100) * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");
  const Brands = mongoose.connection.collection("brands");

  if (ROLLBACK_FILE) {
    const rows = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    for (const r of rows) {
      await Products.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        {
          $set: { price: r.price },
          $unset: {
            "specs.listPriceBeforeUplift": "",
            "specs.upliftPercent": "",
          },
        },
      );
    }
    console.log(`Rolled back ${rows.length} products.`);
    await mongoose.disconnect();
    return;
  }

  const brand = await Brands.findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand ${BRAND_SLUG} not found`);

  const all = await Products.find({ brand: brand._id, price: { $gt: 0 } })
    .project({ _id: 1, name: 1, price: 1, specs: 1 })
    .toArray();

  // Skip anything already uplifted, so a second run is a no-op.
  const pending = all.filter(
    (p) => p?.specs?.listPriceBeforeUplift == null,
  );
  const alreadyDone = all.length - pending.length;

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`brand            : ${brand.name}`);
  console.log(`uplift           : +${UPLIFT_PERCENT}%`);
  console.log(`priced products  : ${all.length}`);
  console.log(`already uplifted : ${alreadyDone} (skipped)`);
  console.log(`to update        : ${pending.length}\n`);

  pending.slice(0, 10).forEach((p) =>
    console.log(
      `   £${String(p.price).padEnd(8)} -> £${String(uplift(p.price)).padEnd(8)} ${p.name.slice(0, 44)}`,
    ),
  );
  if (pending.length > 10) console.log(`   … and ${pending.length - 10} more`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write these prices.");
    await mongoose.disconnect();
    return;
  }
  if (!pending.length) {
    console.log("Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const backup = pending.map((p) => ({ _id: String(p._id), price: p.price }));
  const file = path.join(
    process.cwd(),
    `rollback-direct-flooring-uplift-${backup.length}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRollback file: ${path.basename(file)}`);

  const res = await Products.bulkWrite(
    pending.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            price: uplift(p.price),
            "specs.listPriceBeforeUplift": p.price,
            "specs.upliftPercent": UPLIFT_PERCENT,
          },
        },
      },
    })),
    { ordered: false },
  );

  console.log(`Products updated: ${res.modifiedCount}`);
  console.log(
    `\nTo undo: node --require ./scripts/mongo-dns.cjs scripts/uplift-direct-flooring.cjs --rollback ${path.basename(file)}`,
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

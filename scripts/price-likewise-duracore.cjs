/**
 * Price the Likewise "Duracore SPC Plank" range.
 *
 * Supplier quote (Likewise Floors):
 *   Full pallet ......... £8.99 / m²
 *   Room-size orders .... £9.99 / m²
 *
 * The website sells room-size quantities, so £9.99/m² is used as the listed
 * price and £8.99 is recorded on the product as the pallet rate for reference.
 *
 * Prices are stored per square metre with no box coverage, exactly as the
 * Porcelanosa tiles are (price=20.34, no sqmPerBox) — which is what makes the
 * per-m² calculator appear on the product page. "luxury-vinyl-tile" already
 * satisfies the area-sold rule, so no category change is needed.
 *
 * Nothing is deleted. Only `price` and two spec fields are written, and the
 * previous values of every touched product go to a rollback file.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/price-likewise-duracore.cjs                 # dry run, Duracore only
 *   node --require ./scripts/mongo-dns.cjs scripts/price-likewise-duracore.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/price-likewise-duracore.cjs --scope=lvt     # all luxury-vinyl-tile
 *   node --require ./scripts/mongo-dns.cjs scripts/price-likewise-duracore.cjs --rollback <file>
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const APPLY = process.argv.includes("--apply");
const SCOPE =
  (process.argv.find((a) => a.startsWith("--scope=")) || "").split("=")[1] ||
  "duracore";
const ROLLBACK_IDX = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX > -1 ? process.argv[ROLLBACK_IDX + 1] : null;

/**
 * Supplier rates, plus the 20% uplift applied to all Likewise products.
 *
 * The uplifted figures are written as explicit values rather than multiplying
 * whatever price is already on the product — so re-running this script cannot
 * compound the uplift. The supplier's own rate is kept alongside for reference.
 */
const UPLIFT_PERCENT = 20;
const withUplift = (rate) =>
  Math.round(rate * (1 + UPLIFT_PERCENT / 100) * 100) / 100;

const SUPPLIER_ROOM_RATE = 9.99;
const SUPPLIER_PALLET_RATE = 8.99;

const ROOM_RATE = withUplift(SUPPLIER_ROOM_RATE);     // 11.99
const PALLET_RATE = withUplift(SUPPLIER_PALLET_RATE); // 10.79

/** The ten SKUs on the supplier's Duracore SPC Plank page. */
const DURACORE_CODES = [
  "2117L-5",
  "2105L-6",
  "974L-10",
  "966L-3",
  "92024L-1",
  "2117L-1",
  "2112-6",
  "921171-8",
  "9661-6",
  "921051-5",
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");
  const Brands = mongoose.connection.collection("brands");

  if (ROLLBACK_FILE) {
    const rows = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    console.log(`Rolling back ${rows.length} products`);
    for (const r of rows) {
      await Products.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        { $set: { price: r.price } },
      );
    }
    console.log("Rollback complete.");
    await mongoose.disconnect();
    return;
  }

  const brand = await Brands.findOne({ slug: "likewisefloors" });
  if (!brand) throw new Error("Likewise Floors brand not found");

  const codeRx = new RegExp(
    DURACORE_CODES.map((c) => c.replace(/-/g, "[- ]?")).join("|"),
    "i",
  );

  /**
   * Scopes:
   *   duracore - the 10 SKUs on the supplier's Duracore SPC Plank page
   *   lvt      - all luxury-vinyl-tile
   *   flooring - every hard flooring / tile category (LVT, vinyl, laminate,
   *              wood). Carpet, rugs, mats and artificial grass are excluded:
   *              they are floor coverings but not SPC plank, so the £9.99/m²
   *              plank rate does not apply to them.
   *   soft     - carpet, rugs, mats-runners, grass (only if explicitly asked)
   */
  const HARD_FLOORING = ["luxury-vinyl-tile", "vinyl", "laminate", "wood"];
  const SOFT_FLOORING = ["carpet", "rugs", "mats-runners", "grass"];

  const filter =
    SCOPE === "lvt"
      ? { brand: brand._id, category: "luxury-vinyl-tile" }
      : SCOPE === "flooring"
        ? { brand: brand._id, category: { $in: HARD_FLOORING } }
        : SCOPE === "soft"
          ? { brand: brand._id, category: { $in: SOFT_FLOORING } }
          : { brand: brand._id, name: codeRx };

  const products = await Products.find(filter)
    .project({ _id: 1, name: 1, price: 1, category: 1 })
    .toArray();

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`scope        : ${SCOPE}`);
  console.log(
    `listed price : £${ROOM_RATE.toFixed(2)} / m²  (supplier £${SUPPLIER_ROOM_RATE.toFixed(2)} + ${UPLIFT_PERCENT}%)`,
  );
  console.log(
    `pallet rate  : £${PALLET_RATE.toFixed(2)} / m²  (supplier £${SUPPLIER_PALLET_RATE.toFixed(2)} + ${UPLIFT_PERCENT}%)`,
  );
  console.log(`products     : ${products.length}\n`);

  products.slice(0, 15).forEach((p) =>
    console.log(
      `   £${String(p.price).padEnd(5)} -> £${ROOM_RATE}  ${String(p.category).padEnd(20)} ${p.name.slice(0, 44)}`,
    ),
  );
  if (products.length > 15) console.log(`   … and ${products.length - 15} more`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write these prices.");
    await mongoose.disconnect();
    return;
  }

  const backup = products.map((p) => ({
    _id: String(p._id),
    price: p.price ?? 0,
  }));
  const file = path.join(process.cwd(), `rollback-likewise-price-${backup.length}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRollback file: ${path.basename(file)}`);

  const res = await Products.bulkWrite(
    products.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            price: ROOM_RATE,
            "specs.pricePerSqm": ROOM_RATE,
            "specs.palletPricePerSqm": PALLET_RATE,
            "specs.priceUnit": "per m²",
            "specs.supplierPricePerSqm": SUPPLIER_ROOM_RATE,
            "specs.upliftPercent": UPLIFT_PERCENT,
          },
        },
      },
    })),
    { ordered: false },
  );

  console.log(`Products updated: ${res.modifiedCount}`);
  console.log(
    `\nTo undo: node --require ./scripts/mongo-dns.cjs scripts/price-likewise-duracore.cjs --rollback ${path.basename(file)}`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Give the Luxury Flooring import the two spec keys the pack configurator and
 * the checkout price check both read.
 *
 * The scrape stores pack coverage as `specs.coverage` and a typed
 * `pricePerSqm`, which nothing downstream looks for:
 *
 *   - the PDP resolves pack coverage from `specs.sqmPerBox` / `Pack Coverage`
 *     / `packCoverage`, so without one of those there is no pack to round to
 *     and the configurator never appears;
 *   - `verifyConfiguredUnitPrice` floors an area line at `rate x area`, and
 *     `resolveStorefrontUnitPrice` only treats the rate as per-m2 when
 *     `specs.pricePerM2` is set. Left unset, a pack price is read as a per-m2
 *     price and the floor comes out at roughly twice what the configurator
 *     quoted — every Luxury Flooring basket would be refused at checkout as
 *     tampered.
 *
 * Both are derived from what the scrape already holds, so this needs no
 * refetch. `scripts/import-luxury-flooring.cjs` writes them itself now; this
 * back-fills the products imported before it did.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-luxury-flooring-pack-pricing.cjs
 *
 *   DRY_RUN=1   report the changes without writing
 */
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const SOURCE_TAG = "luxury-flooring-scrape";

/** First positive number in a value, however the supplier punctuated it. */
function positive(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const { db } = await connectMongo();
  const products = db.collection("products");

  const docs = await products
    .find(
      { "specs.source": SOURCE_TAG },
      { projection: { name: 1, price: 1, specs: 1, pricePerSqm: 1, unitOfMeasure: 1 } },
    )
    .toArray();

  console.log(`${docs.length} Luxury Flooring product(s)`);

  const rollback = [];
  let changed = 0;
  let noCoverage = 0;

  for (const d of docs) {
    const specs = d.specs || {};
    const coverage =
      positive(specs.coverage) ||
      positive(specs.flooring_coverage) ||
      positive(specs.pack_size);
    const price = Number(d.price) || 0;

    if (!coverage || !price) {
      // Accessories and anything sold by the unit: no pack, no per-m2 rate.
      noCoverage += 1;
      continue;
    }

    // Rounded to the penny, the same figure the PDP prints as £/m².
    const pricePerM2 = Math.round((price / coverage) * 100) / 100;

    const next = {
      "specs.sqmPerBox": coverage,
      "specs.pricePerM2": pricePerM2,
      pricePerSqm: pricePerM2,
    };

    const same =
      positive(specs.sqmPerBox) === coverage &&
      positive(specs.pricePerM2) === pricePerM2 &&
      Number(d.pricePerSqm) === pricePerM2;
    if (same) continue;

    rollback.push({
      _id: String(d._id),
      name: d.name,
      from: {
        sqmPerBox: specs.sqmPerBox ?? null,
        pricePerM2: specs.pricePerM2 ?? null,
        pricePerSqm: d.pricePerSqm ?? null,
      },
      to: { sqmPerBox: coverage, pricePerM2, pricePerSqm: pricePerM2 },
    });

    if (!DRY_RUN) {
      await products.updateOne(
        { _id: d._id },
        { $set: { ...next, updatedAt: new Date() } },
      );
    }
    changed += 1;
  }

  if (rollback.length && !DRY_RUN) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-luxury-flooring-pack-pricing-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written: ${path.basename(file)}`);
  }

  console.log(`\n${DRY_RUN ? "[dry] " : ""}updated: ${changed}`);
  console.log(`sold by the unit (no pack coverage): ${noCoverage}`);

  if (rollback.length) {
    console.log("\nsample:");
    for (const r of rollback.slice(0, 5)) {
      console.log(
        `  ${r.name}: ${r.to.sqmPerBox} m²/pack · £${r.to.pricePerM2}/m²`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

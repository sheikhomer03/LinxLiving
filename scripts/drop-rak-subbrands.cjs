/**
 * Drop RAK Ceramics' sub-brands; keep the range as `rangeName`.
 *
 * The import read the price list's "Range" column as a sub-brand
 * (import-rak-ceramics.cjs), so all 100 of RAK's own product families —
 * RAK-Washington, RAK-Feeling, RAK-Petit Round, RAK-Cleo — were filed as if
 * RAK were a parent company with a hundred subsidiaries. It is not: a range is
 * a collection, the same as any supplier's series. Twenty of them backed a
 * single product, which made a navigation tree mostly of dead ends.
 *
 * Nothing is lost. Every one of those products already carries the same value
 * in `rangeName` (a real schema field, indexed, checked here before anything is
 * written) and in `specs.range`, so the range stays browsable and filterable
 * after the sub-brands are gone.
 *
 * Scoped to RAK. Four other brands — The Under Floor Heating, MB Decor, UK
 * Bifold Door Factory, Flooring Sales — use sub-brands for genuinely separate
 * marques and are not touched.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/drop-rak-subbrands.cjs
 *
 *   DRY=1                 report what would change, write nothing
 *   ROLLBACK=<file.json>  put the sub-brands back
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");

const DRY = process.env.DRY === "1";
const ROLLBACK_FILE = process.env.ROLLBACK || "";
const BRAND_SLUG = "rak-ceramics";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brands = db.collection("brands");
  const products = db.collection("products");

  if (ROLLBACK_FILE) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    await brands.updateOne(
      { _id: new mongoose.Types.ObjectId(data.brandId) },
      { $set: { subBrands: data.subBrands } },
    );
    const ops = data.products.map((r) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(r._id) },
        update: { $set: { subBrand: r.subBrand } },
      },
    }));
    for (let i = 0; i < ops.length; i += 500) {
      await products.bulkWrite(ops.slice(i, i + 500));
    }
    console.log(
      `Restored ${data.subBrands.length} sub-brand(s) and ${ops.length} product(s).`,
    );
    await mongoose.disconnect();
    return;
  }

  const brand = await brands.findOne({ slug: BRAND_SLUG });
  if (!brand) {
    console.error(`No brand with slug "${BRAND_SLUG}".`);
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  const filter = {
    $or: [{ brand: brand._id }, { brands: brand._id }],
    subBrand: { $nin: ["", null] },
  };
  const affected = await products
    .find(filter, { projection: { subBrand: 1, rangeName: 1 } })
    .toArray();

  // The range is the whole point of keeping this reversible — refuse to clear a
  // sub-brand off a product that has nowhere else to record it.
  const unsafe = affected.filter((p) => !String(p.rangeName || "").trim());

  console.log(`brand            : ${brand.name} (${brand.slug})`);
  console.log(`sub-brands on it : ${(brand.subBrands || []).length}`);
  console.log(`products to clear: ${affected.length}`);
  console.log(`  of those, missing a rangeName to fall back on: ${unsafe.length}`);

  if (unsafe.length) {
    console.error(
      "\nRefusing to run: those products would lose their range entirely.\n" +
        "Backfill rangeName from subBrand first, then re-run.",
    );
    unsafe.slice(0, 5).forEach((p) => console.error(`   ${p._id} ${p.subBrand}`));
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  if (DRY) {
    console.log("\nDRY=1 — nothing written.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(__dirname, "..", `rollback-rak-subbrands-${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        brandId: String(brand._id),
        subBrands: brand.subBrands || [],
        products: affected.map((p) => ({
          _id: String(p._id),
          subBrand: p.subBrand,
        })),
      },
      null,
      1,
    ),
  );

  await brands.updateOne(
    { _id: brand._id },
    { $set: { subBrands: [], updatedAt: new Date() } },
  );

  const ops = affected.map((p) => ({
    updateOne: { filter: { _id: p._id }, update: { $set: { subBrand: "" } } },
  }));
  for (let i = 0; i < ops.length; i += 500) {
    await products.bulkWrite(ops.slice(i, i + 500));
  }

  console.log(
    `\nCleared ${(brand.subBrands || []).length} sub-brand(s) from the brand ` +
      `and ${ops.length} product(s). Ranges kept in rangeName.`,
  );
  console.log(`Rollback: ${path.basename(file)}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

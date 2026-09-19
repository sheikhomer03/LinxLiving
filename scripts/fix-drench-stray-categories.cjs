/**
 * File the products that landed under "Drench" or no category at all.
 *
 * 24 products were reached through Drench's own Brands pages
 * ("Brands > Burlington"), whose breadcrumb names a manufacturer rather than
 * a product category — so the importer either took the brand name as the
 * category or found nothing. Both show up as bogus entries in the category
 * list.
 *
 * They are real, priced, Shopify-synced products, so they are re-filed rather
 * than removed, using the `Type` attribute Drench publishes in its own
 * specification table ("Towel Rails", "Robe & Towel Hooks"). Every one of the
 * 24 carries it.
 *
 * Env:
 *   DRY_RUN=1  report only
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";

/** Drench's own Type values, onto the nine categories the brand really uses. */
const TYPE_TO_CATEGORY = [
  [/robe|towel hook/i, "Accessories"],
  [/towel rail|radiator|heating element/i, "Heating"],
  [/shower (enclosure|door|tray|accessor|installation|set|valve)|wetroom|shower panel/i, "Showers"],
  [/flush plate|toilet|cistern|basin/i, "Toilets & Basins"],
  [/bath filler|bath shower mixer|mixer|tap|valve/i, "Taps"],
  [/bath\b/i, "Baths"],
  [/mirror/i, "Mirrors"],
  [/furniture|vanity|unit/i, "Furniture"],
];

function categoryFor(type) {
  for (const [rx, cat] of TYPE_TO_CATEGORY) if (rx.test(type)) return cat;
  return "Accessories";
}

async function main() {
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ slug: "drench" });
  const secConn = await mongoose
    .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 })
    .asPromise();
  const P = secConn.db.collection("products");

  const filter = {
    brand: brand._id,
    $or: [{ category: "Drench" }, { category: "" }, { category: null }, { category: { $exists: false } }],
  };
  const rows = await P.find(filter).toArray();
  console.log("stray products: " + rows.length + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  const ops = [];
  const tally = {};
  for (const r of rows) {
    const t =
      ((r.attributes || []).find((a) => /^type$/i.test(a.label)) || {}).value ||
      (r.specs && r.specs.Type) ||
      "";
    const category = categoryFor(String(t));
    // The supplier's first Type value is the narrower grouping.
    const subCategory = String(t).split(",")[0].trim();
    tally[category] = (tally[category] || 0) + 1;
    console.log("   " + String(r.name).slice(0, 34).padEnd(36) + category.padEnd(18) + subCategory.slice(0, 28));
    ops.push({
      updateOne: {
        filter: { _id: r._id },
        update: { $set: { category, subCategory, categoryFixedAt: new Date() } },
      },
    });
  }

  if (!DRY_RUN && ops.length) await P.bulkWrite(ops, { ordered: false });

  console.log("");
  console.log("assigned: " + JSON.stringify(tally));
  const left = await P.countDocuments(filter);
  console.log("remaining stray: " + left);
  await secConn.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

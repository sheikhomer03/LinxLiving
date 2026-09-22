/**
 * Give Drench products a department and slug categories, so they are
 * reachable from the catalogue rather than only by direct link.
 *
 * They were imported with display names ("Toilets & Basins") where the
 * listing matches slugs ("toilets-basins"), and with no department at all —
 * which kept 5,554 products off every category page, department page and
 * mega-menu column.
 *
 * Each of the nine categories maps onto a menu that ALREADY EXISTS under
 * Bathrooms or Accessories, so nothing new appears in the navigation: the
 * products simply start showing under the columns already there.
 *
 * Sub-categories keep the supplier's grouping, slugified.
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

/** Drench category -> [existing menu slug, department slug]. */
const MAP = {
  "Showers": ["showers", "bathrooms"],
  "Toilets & Basins": ["toilets-basins", "bathrooms"],
  "Taps": ["taps", "bathrooms"],
  "Baths": ["baths", "bathrooms"],
  "Furniture": ["bathroom-furniture", "bathrooms"],
  "Mirrors": ["bathroom-mirrors", "bathrooms"],
  "Bathroom Suites": ["suites", "bathrooms"],
  // The "Heating" menu sits under Bathrooms — these are towel rails and
  // bathroom radiators, not the whole-house Heating department.
  "Heating": ["heating", "bathrooms"],
  "Accessories": ["accessories", "accessories"],
};

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function main() {
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ slug: "drench" });
  const secConn = await mongoose
    .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 })
    .asPromise();
  const P = secConn.db.collection("products");

  console.log("mode: " + (DRY_RUN ? "DRY RUN" : "LIVE"));
  console.log("");

  let total = 0, unmapped = 0;
  const tally = {};
  const ops = [];

  for await (const doc of P.find({ brand: brand._id }).project({
    category: 1,
    subCategory: 1,
  })) {
    total += 1;
    const hit = MAP[String(doc.category || "").trim()];
    if (!hit) { unmapped += 1; continue; }
    const [cat, dept] = hit;
    const sub = doc.subCategory ? slugify(doc.subCategory) : "";
    tally[dept + " / " + cat] = (tally[dept + " / " + cat] || 0) + 1;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            department: dept,
            category: cat,
            subCategory: sub,
            // The supplier's own wording, kept for the breadcrumb and admin.
            categoryLabel: String(doc.category || "").trim(),
            subCategoryLabel: String(doc.subCategory || "").trim(),
          },
        },
      },
    });
  }

  console.log("mapping:");
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log("   " + k.padEnd(34) + String(n).padStart(5));
  }
  console.log("");
  console.log("products     : " + total);
  console.log("to update    : " + ops.length);
  console.log("unmapped     : " + unmapped);

  if (!DRY_RUN && ops.length) {
    for (let i = 0; i < ops.length; i += 500) {
      await P.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
    console.log("");
    console.log("written.");
    console.log("  department set : " + await P.countDocuments({ brand: brand._id, department: { $nin: [null, ""] } }));
    console.log("  slug categories: " + await P.countDocuments({ brand: brand._id, category: { $not: /[A-Z ]/ } }));
  }

  await secConn.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

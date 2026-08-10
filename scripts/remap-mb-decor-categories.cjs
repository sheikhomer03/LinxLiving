/**
 * Remap MB Decor: treat site ranges as categories (not sub-brands).
 * Keep only true external manufacturers as Brand.subBrands[].
 *
 * Categories stay on brand-scoped menus (already imported).
 * product.subBrand / menu.subBrand cleared unless manufacturer match.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/remap-mb-decor-categories.cjs
 *   DRY_RUN=1 node --require ./scripts/mongo-dns.cjs scripts/remap-mb-decor-categories.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const BRAND_SLUG = "mb-decor";
const DRY = process.env.DRY_RUN === "1";

/** External manufacturers only (not MB Decor own ranges / nav categories) */
const MANUFACTURER_SUB_BRANDS = [
  { name: "VOX", slug: "vox" },
  { name: "Vilo", slug: "vilo" },
  { name: "Dumaplast", slug: "dumaplast" },
  { name: "Moduleo", slug: "moduleo" },
  { name: "Extruda", slug: "extruda" },
];

const MANUFACTURER_SLUGS = new Set(MANUFACTURER_SUB_BRANDS.map((s) => s.slug));

/** Map product/category signals → manufacturer sub-brand slug */
function manufacturerFromProduct(p) {
  const cats = [
    ...(p.specs?.mbDecorCategories || []),
    p.category,
    p.subCategory,
  ]
    .map((s) => String(s || "").toLowerCase())
    .filter(Boolean);
  const name = String(p.name || "").toLowerCase();
  const prev = String(p.subBrand || "").toLowerCase();

  const blob = `${cats.join(" ")} ${name} ${prev}`;

  if (
    /\bvox\b|linerio|kerra(deco|front)|fronto|solvo/.test(blob) ||
    cats.some((c) =>
      /^(vox|linerio|kerradeco|kerrafront|vox-fronto|vox-solvo)/.test(c),
    )
  ) {
    return "vox";
  }
  if (/\bvilo\b/.test(blob) || cats.some((c) => c.startsWith("vilo"))) {
    return "vilo";
  }
  if (
    /duma(wall|floor|plast)|inspiro/.test(blob) ||
    cats.some((c) => /duma|inspiro/.test(c))
  ) {
    return "dumaplast";
  }
  if (/\bmoduleo\b/.test(blob) || cats.some((c) => c.startsWith("moduleo"))) {
    return "moduleo";
  }
  if (
    /\bextruda\b/.test(blob) ||
    cats.some((c) => /extruda|decking/.test(c))
  ) {
    return "extruda";
  }
  return "";
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 30000,
  });
  const db = mongoose.connection.db;
  console.log(`MB Decor category remap${DRY ? " (DRY RUN)" : ""}`);

  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand not found: ${BRAND_SLUG}`);

  const products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({
      name: 1,
      category: 1,
      subCategory: 1,
      subBrand: 1,
      specs: 1,
    })
    .toArray();

  const menus = await db
    .collection("menus")
    .find({
      $or: [{ brand: brand._id }, { brand: String(brand._id) }],
    })
    .project({ name: 1, slug: 1, subBrand: 1, subBrands: 1 })
    .toArray();

  // category slug → Set of manufacturer subBrand slugs (from products)
  const catToSubs = new Map();
  const productUpdates = [];
  let cleared = 0;
  let setMfr = 0;

  for (const p of products) {
    const next = manufacturerFromProduct(p);
    const prev = String(p.subBrand || "").toLowerCase();
    if (next !== prev) {
      productUpdates.push({ id: p._id, name: p.name, prev, next });
      if (!next) cleared += 1;
      else setMfr += 1;
    }
    if (next && p.category) {
      const key = String(p.category).toLowerCase();
      if (!catToSubs.has(key)) catToSubs.set(key, new Set());
      catToSubs.get(key).add(next);
    }
    if (next && p.subCategory) {
      const key = String(p.subCategory).toLowerCase();
      if (!catToSubs.has(key)) catToSubs.set(key, new Set());
      catToSubs.get(key).add(next);
    }
  }

  const menuUpdates = [];
  for (const m of menus) {
    const slug = String(m.slug || "").toLowerCase();
    // Only attach manufacturer sub-brands if products in that menu slug use them.
    // Parent ranges like decorwall get none (they're categories, not manufacturers).
    let subs = [...(catToSubs.get(slug) || [])].filter((s) =>
      MANUFACTURER_SLUGS.has(s),
    );

    // Top-level manufacturer category menus themselves map 1:1
    if (MANUFACTURER_SLUGS.has(slug)) subs = [slug];
    // Child ranges under manufacturer families
    if (/^(linerio|kerradeco|kerrafront|vox-)/.test(slug)) subs = ["vox"];
    if (/^vilo-/.test(slug)) subs = ["vilo"];
    if (/^duma|^inspiro/.test(slug)) subs = ["dumaplast"];
    if (/^moduleo/.test(slug)) subs = ["moduleo"];
    if (/^extruda|^decking/.test(slug)) subs = ["extruda"];

    subs = [...new Set(subs)].sort();
    const nextLegacy = subs.length === 1 ? subs[0] : "";
    const prev = Array.isArray(m.subBrands)
      ? [...m.subBrands].map(String).sort()
      : [];
    const prevLegacy = String(m.subBrand || "");
    const changed =
      JSON.stringify(prev) !== JSON.stringify(subs) ||
      prevLegacy !== nextLegacy;
    if (changed) {
      menuUpdates.push({
        id: m._id,
        name: m.name,
        slug: m.slug,
        prevSubBrands: prev,
        subBrands: subs,
        subBrand: nextLegacy,
      });
    }
  }

  if (!DRY) {
    await db.collection("brands").updateOne(
      { _id: brand._id },
      {
        $set: {
          subBrands: MANUFACTURER_SUB_BRANDS,
          updatedAt: new Date(),
        },
      },
    );

    for (const u of productUpdates) {
      await db.collection("products").updateOne(
        { _id: u.id, brand: brand._id },
        { $set: { subBrand: u.next, updatedAt: new Date() } },
      );
    }

    for (const u of menuUpdates) {
      await db.collection("menus").updateOne(
        { _id: u.id, brand: brand._id },
        {
          $set: {
            subBrands: u.subBrands,
            subBrand: u.subBrand,
            updatedAt: new Date(),
          },
        },
      );
    }
  }

  const report = {
    at: new Date().toISOString(),
    dry: DRY,
    manufacturerSubBrands: MANUFACTURER_SUB_BRANDS,
    stats: {
      products: products.length,
      productsUpdated: productUpdates.length,
      productsClearedToCategoryOnly: cleared,
      productsSetToManufacturer: setMfr,
      menusUpdated: menuUpdates.length,
    },
    sampleProductUpdates: productUpdates.slice(0, 20),
    sampleMenuUpdates: menuUpdates.slice(0, 25),
  };

  const out = path.join(__dirname, "_tmp-mb-decor-category-remap-report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(
    `Brand subBrands → ${MANUFACTURER_SUB_BRANDS.map((s) => s.name).join(", ")}`,
  );
  console.log(
    `Products updated=${productUpdates.length} (cleared=${cleared}, manufacturer=${setMfr})`,
  );
  console.log(`Menus updated=${menuUpdates.length}`);
  console.log(`Report → ${out}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

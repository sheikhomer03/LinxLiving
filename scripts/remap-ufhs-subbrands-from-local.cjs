/**
 * Remap UFHS category ↔ manufacturer sub-brands using LOCAL data.
 *
 * Sub-brands = official "Shop by Brand" manufacturers from
 * https://www.theunderfloorheatingstore.com/ nav (NOT every product vendor).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/remap-ufhs-subbrands-from-local.cjs
 *   DRY_RUN=1 node --require ./scripts/mongo-dns.cjs scripts/remap-ufhs-subbrands-from-local.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const BRAND_SLUG = "the-under-floor-heating";
const DRY = process.env.DRY_RUN === "1";

/**
 * Official Shop by Brand names from theunderfloorheatingstore.com nav:
 * Electric / Water / Thermostats / Adhesives sections.
 * (John Guest appears twice on site — once only here.)
 */
const SHOP_BY_BRAND = [
  "ProWarm",
  "Floorwarmers",
  "Warmup",
  "Wavin",
  "Polypipe",
  "John Guest",
  "Heatmiser",
  "Salus",
  "Hive",
  "Ultra Tile",
  "Mapei",
  "BAL",
];

/** Map product vendor strings → canonical Shop by Brand name */
const VENDOR_ALIASES = {
  prowarm: "ProWarm",
  floorwarmers: "Floorwarmers",
  warmup: "Warmup",
  wavin: "Wavin",
  polypipe: "Polypipe",
  "john guest": "John Guest",
  johnguest: "John Guest",
  heatmiser: "Heatmiser",
  salus: "Salus",
  hive: "Hive",
  "ultra tile": "Ultra Tile",
  ultratile: "Ultra Tile",
  mapei: "Mapei",
  bal: "BAL",
};

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function canonicalShopBrand(vendor) {
  const key = String(vendor || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!key) return null;
  if (VENDOR_ALIASES[key]) return VENDOR_ALIASES[key];
  // Exact match against allowlist (case-insensitive)
  const hit = SHOP_BY_BRAND.find((n) => n.toLowerCase() === key);
  return hit || null;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI required");
  await mongoose.connect(uri, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 30000,
  });
  const db = mongoose.connection.db;
  console.log(
    `UFHS Shop-by-Brand sub-brand remap (${SHOP_BY_BRAND.length} brands)${DRY ? " (DRY RUN)" : ""}`
  );

  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand not found: ${BRAND_SLUG}`);
  const brandId = brand._id;
  const brandIdStr = String(brandId);

  const products = await db
    .collection("products")
    .find(
      { brand: brandId },
      {
        projection: {
          _id: 1,
          name: 1,
          category: 1,
          subCategory: 1,
          specs: 1,
          subBrand: 1,
        },
      }
    )
    .toArray();

  const menus = await db
    .collection("menus")
    .find(
      { $or: [{ brand: brandId }, { brand: brandIdStr }] },
      {
        projection: {
          _id: 1,
          name: 1,
          slug: 1,
          shopifyHandle: 1,
          subBrand: 1,
          subBrands: 1,
          brand: 1,
        },
      }
    )
    .toArray();

  const vendorCounts = new Map();
  for (const name of SHOP_BY_BRAND) vendorCounts.set(name, 0);

  for (const p of products) {
    const canon = canonicalShopBrand(p.specs?.vendorBrand);
    if (!canon) continue;
    vendorCounts.set(canon, (vendorCounts.get(canon) || 0) + 1);
  }

  const subBrands = SHOP_BY_BRAND.map((name) => ({
    name,
    slug: slugify(name),
    count: vendorCounts.get(name) || 0,
  }));

  console.log(
    `products=${products.length} menus=${menus.length} shopByBrand=${subBrands.length}`
  );
  console.log(
    "counts:",
    subBrands.map((s) => `${s.name}:${s.count}`).join(", ")
  );

  const slugToSubs = new Map();
  for (const menu of menus) {
    const s = String(menu.slug || "").toLowerCase();
    if (s && !slugToSubs.has(s)) slugToSubs.set(s, new Set());
  }

  const productUpdates = [];
  const productClears = [];
  let matchedProducts = 0;
  let otherVendorProducts = 0;

  for (const p of products) {
    const canon = canonicalShopBrand(p.specs?.vendorBrand);
    let subSlug = null;
    if (canon) {
      matchedProducts += 1;
      subSlug = slugify(canon);
    } else {
      otherVendorProducts += 1;
      if (p.subBrand) {
        productClears.push({
          id: p._id,
          name: p.name,
          vendor: p.specs?.vendorBrand,
          prev: p.subBrand,
        });
      }
    }

    if (subSlug && String(p.subBrand || "") !== subSlug) {
      productUpdates.push({
        id: p._id,
        subBrand: subSlug,
        name: p.name,
        vendor: canon,
      });
    }

    if (!subSlug) continue;

    const handles = new Set();
    if (p.category) handles.add(String(p.category).toLowerCase());
    if (p.subCategory) handles.add(String(p.subCategory).toLowerCase());
    for (const h of p.specs?.ufhsCollections || []) {
      if (h) handles.add(String(h).toLowerCase());
    }

    for (const h of handles) {
      if (!slugToSubs.has(h)) slugToSubs.set(h, new Set());
      slugToSubs.get(h).add(subSlug);
    }
  }

  const menuUpdates = [];
  for (const menu of menus) {
    const slug = String(menu.slug || "").toLowerCase();
    const handle = String(menu.shopifyHandle || "").toLowerCase();
    const fromSlug = slugToSubs.get(slug) || new Set();
    const fromHandle =
      handle && handle !== slug ? slugToSubs.get(handle) : null;
    const merged = new Set([...fromSlug, ...(fromHandle || [])]);
    const subs = [...merged].sort();
    const prev = Array.isArray(menu.subBrands)
      ? [...menu.subBrands].map(String).sort()
      : [];
    const legacy = menu.subBrand || "";
    const nextLegacy = subs.length === 1 ? subs[0] : "";
    const changed =
      JSON.stringify(prev) !== JSON.stringify(subs) ||
      String(legacy || "") !== String(nextLegacy || "");
    menuUpdates.push({
      id: menu._id,
      name: menu.name,
      slug: menu.slug,
      subBrands: subs,
      subBrand: nextLegacy,
      changed,
    });
  }
  const menusChanged = menuUpdates.filter((m) => m.changed);

  if (!DRY) {
    await db.collection("brands").updateOne(
      { _id: brandId },
      {
        $set: {
          subBrands: subBrands.map(({ name, slug }) => ({ name, slug })),
          updatedAt: new Date(),
        },
      }
    );

    for (const u of productUpdates) {
      await db.collection("products").updateOne(
        { _id: u.id },
        { $set: { subBrand: u.subBrand, updatedAt: new Date() } }
      );
    }

    for (const u of productClears) {
      await db.collection("products").updateOne(
        { _id: u.id },
        { $set: { subBrand: "", updatedAt: new Date() } }
      );
    }

    for (const u of menuUpdates) {
      await db.collection("menus").updateOne(
        { _id: u.id },
        {
          $set: {
            subBrands: u.subBrands,
            subBrand: u.subBrand,
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  const shared = menuUpdates.filter((m) => m.subBrands.length > 1);
  const withSubs = menuUpdates.filter((m) => m.subBrands.length > 0);

  const report = {
    at: new Date().toISOString(),
    dry: DRY,
    source: "Shop by Brand nav on theunderfloorheatingstore.com",
    brand: { id: brandIdStr, name: brand.name, slug: brand.slug },
    subBrands,
    stats: {
      products: products.length,
      productsMatchedShopByBrand: matchedProducts,
      productsOtherVendorOrHouse: otherVendorProducts,
      productsUpdated: productUpdates.length,
      productsCleared: productClears.length,
      menus: menus.length,
      menusChanged: menusChanged.length,
      menusWithSubBrands: withSubs.length,
      sharedCategories: shared.length,
    },
    sharedCategories: shared.map((m) => ({
      name: m.name,
      slug: m.slug,
      subBrands: m.subBrands,
    })),
  };

  const out = path.join(__dirname, "_tmp-ufhs-subbrand-local-remap-report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(`Set ${subBrands.length} Shop-by-Brand subBrands`);
  console.log(
    `Products matched=${matchedProducts} updated=${productUpdates.length} cleared=${productClears.length} other/house=${otherVendorProducts}`
  );
  console.log(
    `Menus rewritten=${menuUpdates.length} changed=${menusChanged.length} withSubs=${withSubs.length} shared=${shared.length}`
  );
  console.log(`Report → ${out}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

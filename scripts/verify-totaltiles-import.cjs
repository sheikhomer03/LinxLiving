/**
 * Full pre-activation verification for Total Tiles.
 * Checks every guarantee the playbook requires before Brand.isActive = true.
 * Exits with code 1 if ANY check fails — safe to run any number of times.
 */
"use strict";

const path = require("path");
const fs   = require("fs");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}
const mongoose = require("mongoose");

let PASS = 0, FAIL = 0;

function ok(msg)   { PASS++; console.log("  ✓", msg); }
function fail(msg) { FAIL++; console.log("  ✗", msg); }
function head(msg) { console.log("\n══ " + msg + " ══"); }

async function main() {
  const conn1 = await mongoose.createConnection(process.env.MONGODB_URI,   { serverSelectionTimeoutMS: 15000 }).asPromise();
  const conn2 = await mongoose.createConnection(process.env.MONGODB_URL2,  { serverSelectionTimeoutMS: 15000 }).asPromise();
  const db1 = conn1.db;
  const db2 = conn2.db;

  // ── 0. Brand record ────────────────────────────────────────────────────────
  head("0. Brand record");
  const brand = await db1.collection("brands").findOne({ slug: "total-tiles" });
  if (!brand) { fail("brand 'total-tiles' not found in primary"); process.exit(1); }
  ok("brand exists in primary: " + brand._id);
  brand.dataCluster === "secondary" ? ok("dataCluster = secondary") : fail("dataCluster is '" + brand.dataCluster + "', expected secondary");
  brand.isActive === true           ? ok("isActive = true (LIVE — correct)") : fail("isActive = " + brand.isActive + " — should be true after activation");
  const noTTInPrimary = await db1.collection("products").countDocuments({ brand: brand._id });
  noTTInPrimary === 0 ? ok("0 TotalTiles products in primary (correct)") : fail(noTTInPrimary + " TotalTiles products leaked into primary");

  // ── 1. Product count ───────────────────────────────────────────────────────
  head("1. Product count");
  const total = await db2.collection("products").countDocuments({ brand: brand._id });
  total === 687 ? ok("687 products in secondary") : fail("expected 687, got " + total);

  // ── 2. Required fields completeness ───────────────────────────────────────
  head("2. Required field completeness");
  const missingName   = await db2.collection("products").countDocuments({ brand: brand._id, name: { $in: [null, ""] } });
  const missingPrice  = await db2.collection("products").countDocuments({ brand: brand._id, price: { $in: [null, 0] } });
  const missingDept   = await db2.collection("products").countDocuments({ brand: brand._id, department: { $in: [null, ""] } });
  const missingCat    = await db2.collection("products").countDocuments({ brand: brand._id, category:   { $in: [null, ""] } });
  const missingUrl    = await db2.collection("products").countDocuments({ brand: brand._id, sourceUrl:  { $in: [null, ""] } });
  const missingImages = await db2.collection("products").countDocuments({ brand: brand._id, "images.0": { $exists: false } });
  missingName   === 0 ? ok("0 products with empty name")     : fail(missingName   + " products missing name");
  missingPrice  === 0 ? ok("0 products with null/zero price"): fail(missingPrice  + " products have null/zero price");
  missingDept   === 0 ? ok("0 products with empty dept")     : fail(missingDept   + " products missing department");
  missingCat    === 0 ? ok("0 products with empty category") : fail(missingCat    + " products missing category");
  missingUrl    === 0 ? ok("0 products with empty sourceUrl"): fail(missingUrl    + " products missing sourceUrl");
  missingImages === 0 ? ok("0 products with no images")      : fail(missingImages + " products have empty images[]");

  // ── 3. Stock ───────────────────────────────────────────────────────────────
  head("3. Stock");
  const wrongStock = await db2.collection("products").countDocuments({ brand: brand._id, stock: { $ne: 500 } });
  wrongStock === 0 ? ok("all 687 products have stock = 500") : fail(wrongStock + " products have stock ≠ 500");

  // ── 4. RRP sanity ──────────────────────────────────────────────────────────
  head("4. RRP sanity");
  const badRrp = await db2.collection("products").countDocuments({
    brand: brand._id,
    $expr: { $and: [{ $ne: ["$rrpIncVat", null] }, { $lte: ["$rrpIncVat", "$price"] }] }
  });
  badRrp === 0 ? ok("0 products with rrpIncVat ≤ price") : fail(badRrp + " products have rrpIncVat ≤ price");

  // ── 5. Spec key aliases (calculator) ──────────────────────────────────────
  head("5. Spec key aliases for coverage calculator");
  // All tile products that scraped 'Tiles per square meter' must have tilesPerSqm in specs
  const tilesWithRawKey   = await db2.collection("products").countDocuments({ brand: brand._id, "specs.Tiles per square meter": { $exists: true } });
  const tilesWithAlias    = await db2.collection("products").countDocuments({ brand: brand._id, "specs.tilesPerSqm":             { $exists: true } });
  const tilesWithPriceM2  = await db2.collection("products").countDocuments({ brand: brand._id, department: "tiles", "specs.pricePerM2": { $exists: true } });
  const tilesWithSqmPerBox= await db2.collection("products").countDocuments({ brand: brand._id, department: "tiles", "specs.sqmPerBox":  { $exists: true } });
  tilesWithRawKey === tilesWithAlias
    ? ok(tilesWithAlias + " tile products have specs.tilesPerSqm (matches raw key count)")
    : fail("tilesPerSqm alias missing on " + (tilesWithRawKey - tilesWithAlias) + " products");
  tilesWithPriceM2 > 400
    ? ok(tilesWithPriceM2 + " tile products have specs.pricePerM2")
    : fail("only " + tilesWithPriceM2 + " tile products have pricePerM2 — expected 400+");
  tilesWithSqmPerBox > 400
    ? ok(tilesWithSqmPerBox + " tile products have specs.sqmPerBox")
    : fail("only " + tilesWithSqmPerBox + " tile products have sqmPerBox — expected 400+");
  // Accessories must NOT have tilesPerSqm
  const accWithAlias = await db2.collection("products").countDocuments({ brand: brand._id, department: "accessories", "specs.tilesPerSqm": { $exists: true } });
  accWithAlias === 0 ? ok("0 accessory products have spurious tilesPerSqm") : fail(accWithAlias + " accessory products have tilesPerSqm — coverage calc will misfire");

  // ── 6. Dedupe: no sourceUrl appears twice ──────────────────────────────────
  head("6. Dedupe (sourceUrl uniqueness)");
  const dupPipeline = [
    { $match: { brand: brand._id } },
    { $group: { _id: "$sourceUrl", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }
  ];
  const dups = await db2.collection("products").aggregate(dupPipeline).toArray();
  dups.length === 0 ? ok("0 duplicate sourceUrls") : fail(dups.length + " duplicate sourceUrls: " + JSON.stringify(dups.slice(0,3).map(d=>d._id)));

  // ── 7. Shopify sync ────────────────────────────────────────────────────────
  head("7. Shopify sync");
  const withShopifyId  = await db2.collection("products").countDocuments({ brand: brand._id, shopifyProductId: { $exists: true, $ne: null } });
  const withVariantId  = await db2.collection("products").countDocuments({ brand: brand._id, shopifyVariantId: { $exists: true, $ne: null } });
  withShopifyId  === 687 ? ok("687/687 products have shopifyProductId") : fail(withShopifyId  + "/687 have shopifyProductId");
  withVariantId  === 687 ? ok("687/687 products have shopifyVariantId") : fail(withVariantId  + "/687 have shopifyVariantId");

  // ── 8. Image harvest (supplier URLs → Shopify CDN) ────────────────────────
  head("8. Image harvest completeness");
  const withShopifyImages = await db2.collection("products").countDocuments({ brand: brand._id, "shopifyImages.0": { $exists: true } });
  const pendingHarvest    = 687 - withShopifyImages;
  withShopifyImages === 687
    ? ok("687/687 products have shopifyImages[] (harvest complete)")
    : fail(pendingHarvest + " products still pending harvest (re-run shopify-harvest-brand-images.cjs THEN_REWRITE=1)");

  // Check images[] on all harvested products: must be 100% Shopify CDN URLs
  let supplierUrls = 0, shopifyCdnUrls = 0;
  const harvestedProducts = await db2.collection("products")
    .find({ brand: brand._id, "shopifyImages.0": { $exists: true } })
    .project({ images: 1 })
    .toArray();
  for (const p of harvestedProducts) {
    for (const url of p.images || []) {
      if (/cdn\.shopify\.com/i.test(url)) shopifyCdnUrls++;
      else supplierUrls++;
    }
  }
  supplierUrls === 0
    ? ok(shopifyCdnUrls + " images in harvested products: all Shopify CDN URLs")
    : fail(supplierUrls + " supplier URLs still remain in images[] of harvested products");

  // ── 9. Category pairs pre-existed ─────────────────────────────────────────
  head("9. Category pairs (all must pre-exist on site)");
  const ttPairs = await db2.collection("products").aggregate([
    { $match: { brand: brand._id } },
    { $group: { _id: { dept: "$department", cat: "$category" } } }
  ]).toArray();

  const sitePairs = new Set();
  for (const cluster of [db1, db2]) {
    const sp = await cluster.collection("products").aggregate([
      { $match: { brand: { $ne: brand._id } } },
      { $group: { _id: { dept: "$department", cat: "$category" } } }
    ]).toArray();
    sp.forEach(p => sitePairs.add(p._id.dept + "/" + p._id.cat));
  }
  let allPairsOk = true;
  for (const { _id: { dept, cat } } of ttPairs) {
    const key = dept + "/" + cat;
    if (!sitePairs.has(key)) { fail("category pair is NEW (not pre-existing): " + key); allPairsOk = false; }
  }
  if (allPairsOk) ok("all " + ttPairs.length + " category pairs pre-existed on site");

  // ── 10. Sample calculator math cross-check ─────────────────────────────────
  head("10. Calculator math spot-check (5 tile products)");
  const tilesSample = await db2.collection("products")
    .find({ brand: brand._id, department: "tiles", "specs.tilesPerSqm": { $exists: true }, "specs.pricePerM2": { $exists: true } })
    .limit(5).toArray();
  for (const p of tilesSample) {
    const tpSqm = p.specs.tilesPerSqm;
    const sqmBox = p.specs.sqmPerBox;
    const pm2    = p.specs.pricePerM2;
    const computed = sqmBox > 0 ? Number((p.price / sqmBox).toFixed(2)) : null;
    // Allow 2% tolerance for rounding
    const ok2 = computed && Math.abs(computed - pm2) / pm2 < 0.02;
    const scraped = (p.specs["Tiles per square meter"] == tpSqm);
    if (ok2 && scraped) {
      ok(p.name.substring(0,50) + " → £" + pm2 + "/m² ✓");
    } else if (!ok2) {
      fail(p.name.substring(0,50) + " → computed £" + computed + " vs stored £" + pm2 + " (>2% diff)");
    }
  }

  // ── Final ──────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════");
  console.log("  PASSED: " + PASS + "   FAILED: " + FAIL);
  console.log("══════════════════════════════════════════════");

  await conn1.close();
  await conn2.close();

  if (FAIL > 0) {
    console.log("\n✗ Verification FAILED — do NOT activate until all failures are fixed.");
    process.exit(1);
  } else {
    console.log("\n✓ All checks passed — safe to activate.");
    process.exit(0);
  }
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

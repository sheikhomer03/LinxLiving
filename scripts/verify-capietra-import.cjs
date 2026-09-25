const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const mongoose = require("mongoose");

let checksPassed = 0;
let checksFailed = 0;

function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  checksPassed++;
}

function fail(msg) {
  console.log(`  \x1b[31m✗ ${msg}\x1b[0m`);
  checksFailed++;
}

const BRAND_SLUG = "capietra";

async function main() {
  const db1 = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();

  console.log(`\n\x1b[1m══ 0. Brand record ══\x1b[0m`);
  const brand = await db1.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) { fail(`brand '${BRAND_SLUG}' not found in primary`); process.exit(1); }
  ok("brand exists in primary: " + brand._id);
  brand.dataCluster === "primary" ? ok("dataCluster = primary") : fail("dataCluster is '" + brand.dataCluster + "', expected primary");
  brand.isActive === false           ? ok("isActive = false (DRAFT — correct)") : fail("isActive = " + brand.isActive + " — should be false until activation");
  
  const dbStore = db1;

  console.log(`\n\x1b[1m══ 1. Product count ══\x1b[0m`);
  const total = await dbStore.collection("products").countDocuments({ brand: brand._id });
  if (total === 0) fail("0 products found for " + BRAND_SLUG);
  else ok(`${total} products in primary`);

  const products = await dbStore.collection("products").find({ brand: brand._id }).toArray();

  console.log(`\n\x1b[1m══ 2. Required field completeness ══\x1b[0m`);
  const emptyNames = products.filter(p => !p.name || p.name.trim() === "");
  emptyNames.length === 0 ? ok("0 products with empty name") : fail(`${emptyNames.length} products with empty name`);

  // Allow price 0 for Ca'Pietra as some items are Price on Application
  const noPrice = products.filter(p => p.price == null || p.price === "");
  noPrice.length === 0 ? ok("0 products with null/empty price") : fail(`${noPrice.length} products with null/empty price`);
  const zeroPrice = products.filter(p => p.price === 0);
  if (zeroPrice.length > 0) console.log(`  ! ${zeroPrice.length} products with £0 price (POA allowed)`);

  const emptyDept = products.filter(p => !p.department || p.department.trim() === "");
  emptyDept.length === 0 ? ok("0 products with empty dept") : fail(`${emptyDept.length} products with empty dept`);

  const emptyCat = products.filter(p => !p.category || p.category.trim() === "");
  emptyCat.length === 0 ? ok("0 products with empty category") : fail(`${emptyCat.length} products with empty category`);

  const noUrl = products.filter(p => !p.sourceUrl || p.sourceUrl.trim() === "");
  noUrl.length === 0 ? ok("0 products with empty sourceUrl") : fail(`${noUrl.length} products with empty sourceUrl`);

  const noImgs = products.filter(p => !p.images || p.images.length === 0);
  noImgs.length === 0 ? ok("0 products with no images") : fail(`${noImgs.length} products with no images`);

  console.log(`\n\x1b[1m══ 3. Stock ══\x1b[0m`);
  const badStock = products.filter(p => p.stock !== 500);
  badStock.length === 0 ? ok(`all ${total} products have stock = 500`) : fail(`${badStock.length} products do not have stock = 500`);

  console.log(`\n\x1b[1m══ 4. Dedupe (sourceUrl uniqueness) ══\x1b[0m`);
  const urls = new Set();
  let dupes = 0;
  for (const p of products) {
    if (urls.has(p.sourceUrl)) dupes++;
    urls.add(p.sourceUrl);
  }
  dupes === 0 ? ok("0 duplicate sourceUrls") : fail(`${dupes} duplicate sourceUrls`);

  console.log(`\n\x1b[1m══ 5. Shopify sync ══\x1b[0m`);
  const noShopifyId = products.filter(p => !p.shopifyProductId);
  noShopifyId.length === 0 ? ok(`${total}/${total} products have shopifyProductId`) : fail(`${noShopifyId.length} products missing shopifyProductId`);
  const noVariantId = products.filter(p => !p.shopifyVariantId);
  noVariantId.length === 0 ? ok(`${total}/${total} products have shopifyVariantId`) : fail(`${noVariantId.length} products missing shopifyVariantId`);

  console.log(`\n\x1b[1m══ 6. Image harvest completeness ══\x1b[0m`);
  const unharvested = products.filter(p => !p.shopifyImages || p.shopifyImages.length === 0);
  unharvested.length === 0 ? ok(`${total}/${total} products have shopifyImages[] (harvest complete)`) : fail(`${unharvested.length} products missing shopifyImages[]`);
  const totalImgs = products.reduce((acc, p) => acc + (p.shopifyImages || []).length, 0);
  const brokenImgs = products.flatMap(p => p.shopifyImages || []).filter(img => !img.shopifyUrl);
  brokenImgs.length === 0 ? ok(`${totalImgs} images in harvested products: all Shopify CDN URLs`) : fail(`${brokenImgs.length} images failed to harvest (null shopifyUrl)`);

  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  PASSED: ${checksPassed}   FAILED: ${checksFailed}`);
  console.log(`══════════════════════════════════════════════\n`);

  if (checksFailed === 0) {
    console.log("\x1b[32m✓ All checks passed — safe to activate.\x1b[0m\n");
  } else {
    console.log("\x1b[31m✗ Fix failures before activating.\x1b[0m\n");
    process.exit(1);
  }

  await db1.close();
}
main().catch(console.error);

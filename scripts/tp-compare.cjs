/**
 * tp-compare.cjs
 * Compare the 1732 freshly scraped products against the 801 already in MongoDB.
 * Reports: new (not in DB), already exists, zero-price, no-image.
 * NO DB writes — read-only analysis.
 *
 * TP brand ObjectId: 6ab4da49e5975c1dc71a7f97
 * TP source tag:     tilesporcelain-scrape
 */
require('dotenv').config({ path: '.env.local' });
const fs   = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const JSONL = path.join(__dirname, '../.scratch/tilesporcelain/tp-pdp-all.jsonl');
const OUT   = path.join(__dirname, '../.scratch/tilesporcelain/tp-new-only.jsonl');

async function main() {
  // ── 1. Load scraped JSONL ──────────────────────────────────────────────────
  const lines = fs.readFileSync(JSONL, 'utf8').trim().split('\n');
  const scraped = lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  console.log(`Scraped JSONL: ${scraped.length} records`);

  // ── 2. Remove zero-price from scraped list ─────────────────────────────────
  const withPrice = scraped.filter(p => p.pricePerTile && p.pricePerTile > 0);
  const zeroPriceCount = scraped.length - withPrice.length;
  console.log(`Removed ${zeroPriceCount} zero/missing price products → ${withPrice.length} remain`);

  // ── 3. Connect to MongoDB and get existing TP product URLs/SKUs ────────────
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, {
    serverSelectionTimeoutMS: 30000
  }).asPromise();

  const TP_BRAND_ID = new mongoose.Types.ObjectId('6ab4da49e5975c1dc71a7f97');
  const existing = await conn.db.collection('products').find(
    { brand: TP_BRAND_ID },
    { projection: { 'specs.sku': 1, 'specs.url': 1, name: 1, _id: 0 } }
  ).toArray();

  await conn.close();
  console.log(`Existing in DB (Tiles Porcelain): ${existing.length}`);

  // ── 4. Build lookup sets ───────────────────────────────────────────────────
  const existingSkus = new Set(
    existing.map(p => String(p.specs?.sku || '').trim().toLowerCase()).filter(Boolean)
  );
  const existingUrls = new Set(
    existing.map(p => String(p.specs?.url || '').trim().toLowerCase()).filter(Boolean)
  );
  const existingNames = new Set(
    existing.map(p => String(p.name || '').trim().toLowerCase()).filter(Boolean)
  );

  // ── 5. Find new products (not already in DB) ───────────────────────────────
  const newProducts = withPrice.filter(p => {
    const sku  = String(p.sku  || '').trim().toLowerCase();
    const url  = String(p.url  || '').trim().toLowerCase();
    const name = String(p.title|| '').trim().toLowerCase();

    const skuMatch  = sku  && existingSkus.has(sku);
    const urlMatch  = url  && existingUrls.has(url);
    const nameMatch = name && existingNames.has(name);

    return !skuMatch && !urlMatch && !nameMatch;
  });

  // ── 6. Also filter new products: must have at least 1 image ───────────────
  const newWithImages    = newProducts.filter(p => p.images && p.images.length > 0);
  const newWithoutImages = newProducts.filter(p => !p.images || p.images.length === 0);

  // ── 7. Write the "new only" JSONL ready for import ────────────────────────
  fs.writeFileSync(OUT, newWithImages.map(p => JSON.stringify(p)).join('\n') + '\n');

  // ── 8. Summary ─────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('           COMPARISON RESULTS');
  console.log('══════════════════════════════════════════');
  console.log(`  Total scraped:               ${scraped.length}`);
  console.log(`  Removed (zero price):        ${zeroPriceCount}`);
  console.log(`  After price filter:          ${withPrice.length}`);
  console.log(`  Already in DB (skipped):     ${withPrice.length - newProducts.length}`);
  console.log(`  NEW products (not in DB):    ${newProducts.length}`);
  console.log(`    ↳ with images (importable):${newWithImages.length}`);
  console.log(`    ↳ without images (skipped):${newWithoutImages.length}`);
  console.log('══════════════════════════════════════════');
  console.log(`\nNew-only JSONL saved to:\n  ${OUT}`);
  console.log('\nReady for import when you say so.');
}

main().catch(console.error);

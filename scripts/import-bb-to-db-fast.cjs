require('tsx/cjs');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectMongo } = require('./mongo-connect.cjs');
const { syncFullProductToShopify } = require('../src/lib/shopify/sync-product-full.ts');
const { shopifyAdminRequest } = require('../src/lib/shopify/admin.ts');
require('dotenv').config({ path: '.env.local' });

const INPUT_FILE = path.join(__dirname, '..', '.scratch', 'betterbathrooms', 'bb-grouped.json');
const LOG_FILE = path.join(__dirname, '..', '.scratch', 'betterbathrooms', 'bb-import-log.txt');
const CONCURRENCY = 5;

function writeLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

function mapCategory(url) {
  let department = 'bathrooms';
  let category = 'bathroom-furniture';
  if (!url) return { department, category };

  if (url.includes('/c/accessories/')) {
    department = 'accessories';
    category = 'bathroom-accessories';
  } else if (url.includes('/c/vanity-units/')) {
    category = 'vanity-units';
  } else if (url.includes('/c/toilets/')) {
    category = 'toilets';
  } else if (url.includes('/c/baths/')) {
    category = 'baths';
  } else if (url.includes('/c/showers/')) {
    category = 'showers';
  } else if (url.includes('/c/taps/')) {
    category = 'taps';
  } else if (url.includes('/c/heated-towel-rails/') || url.includes('radiator')) {
    category = 'heated-towel-rails';
  } else if (url.includes('/c/mirrors/')) {
    category = 'mirrors';
  } else if (url.includes('/c/bathroom-furniture/')) {
    category = 'bathroom-furniture';
  } else if (url.includes('basin')) {
    category = 'basins';
  }
  return { department, category };
}

async function fetchReadyUrls(productId) {
  if (!productId) return {};
  try {
    const data = await shopifyAdminRequest(`query { product(id: "${productId}") { media(first: 50) { nodes { id status ... on MediaImage { image { url } } } } } }`);
    const map = {};
    for (const n of data?.product?.media?.nodes || []) {
      if (n.status === 'READY' && n.image?.url) map[n.id] = n.image.url;
    }
    return map;
  } catch (e) {
    return {};
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function processProduct(p, col, index, total) {
  try {
    let existing = await col.findOne({ sourceUrl: p.sourceUrl });
    if (!existing) existing = await col.findOne({ name: p.name, "specs.Brand": p.brand });

    if (existing && existing.shopifyProductId && existing.shopifyImages && existing.shopifyImages.length > 0 && existing.shopifyImages.some(img => img.shopifyUrl)) {
      console.log(`[${index}/${total}] SKIP (Already Done): ${p.name}`);
      return { success: true, skipped: true };
    }

    console.log(`[${index}/${total}] Processing: ${p.name}`);
    const { department, category } = mapCategory(p.sourceUrl || p.url);

    const doc = {
      name: p.name,
      description: p.description || p.name,
      price: p.price,
      images: p.images.slice(0, 15),
      shopifyImages: [],
      department,
      category,
      sku: p.sku || `BB-${Date.now()}-${index}`,
      stock: 500,
      specs: { Brand: p.brand, ...p.specs },
      sourceUrl: p.sourceUrl,
      shopifyOptions: p.shopifyOptions || [],
      variants: []
    };

    if (p.variants && p.variants.length > 0) {
      doc.variants = p.variants.map((v, vIdx) => ({
        _id: new mongoose.Types.ObjectId(),
        name: v.name,
        sku: v.sku || `${doc.sku}-V${vIdx}`,
        price: v.price || doc.price,
        stock: 500,
        imageUrl: v.imageUrl,
        option1: v.option1,
        option2: v.option2,
        options: v.options
      }));
    }

    let productId;
    if (existing) {
      productId = existing._id;
      doc.shopifyProductId = existing.shopifyProductId;
      doc.shopifyVariantId = existing.shopifyVariantId;
      doc.shopifyHandle = existing.shopifyHandle;
      doc.shopifyProductUrl = existing.shopifyProductUrl;
      doc.shopifyImages = existing.shopifyImages || [];
      await col.updateOne({ _id: productId }, { $set: doc });
    } else {
      doc._id = new mongoose.Types.ObjectId();
      productId = doc._id;
      await col.insertOne(doc);
    }
    doc._id = productId;

    await syncFullProductToShopify(doc, 'Better Bathrooms');

    await sleep(4000);

    const updatedDoc = await col.findOne({ _id: productId });
    if (updatedDoc && updatedDoc.shopifyProductId) {
      const urlMap = await fetchReadyUrls(updatedDoc.shopifyProductId);
      const newShopifyImages = (updatedDoc.shopifyImages || []).map(img => ({
        ...img,
        shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || ""
      }));
      await col.updateOne({ _id: productId }, { $set: { shopifyImages: newShopifyImages } });
      console.log(`[${index}/${total}] ✓ Done: ${p.name}`);
    }
    return { success: true, skipped: false };
  } catch (e) {
    console.error(`[${index}/${total}] ✗ Error on ${p.name}:`, e.message);
    return { success: false, skipped: false };
  }
}

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const col = db.collection('products');

  const products = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`Found ${products.length} products to import. Starting FAST batch import...`);
  writeLog(`=== IMPORT STARTED === Total products: ${products.length}`);

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let totalProcessed = 0;

  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((p, idx) => processProduct(p, col, i + idx + 1, products.length)));

    for (const r of results) {
      totalProcessed++;
      if (r.skipped) skippedCount++;
      else if (r.success) successCount++;
      else errorCount++;

      // Write to log file every 50 completed items
      if (totalProcessed % 50 === 0 || totalProcessed === products.length) {
        const msg = `Progress: ${totalProcessed}/${products.length} completed. (Success: ${successCount}, Skipped: ${skippedCount}, Errors: ${errorCount})`;
        console.log(`\n=== LOGGING: ${msg} ===\n`);
        writeLog(msg);
      }
    }

    await sleep(1000);
  }

  writeLog(`=== IMPORT COMPLETE === Successfully processed: ${successCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`);
  process.exit(0);
}

main().catch(console.error);

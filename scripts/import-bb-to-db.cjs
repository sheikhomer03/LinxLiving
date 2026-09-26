require('tsx/cjs');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectMongo } = require('./mongo-connect.cjs');
const { syncFullProductToShopify } = require('../src/lib/shopify/sync-product-full.ts');
const { shopifyAdminRequest } = require('../src/lib/shopify/admin.ts');
require('dotenv').config({ path: '.env.local' });

const INPUT_FILE = path.join(__dirname, '..', '.scratch', 'betterbathrooms', 'bb-grouped.json');

function mapCategory(url) {
  let department = 'bathrooms';
  let category = 'bathroom-furniture'; // fallback
  
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

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const col = db.collection('products');

  console.log("Loading grouped products...");
  const products = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`Found ${products.length} products to import.`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log(`\n[${i + 1}/${products.length}] Processing: ${p.name}`);

    try {
      const { department, category } = mapCategory(p.sourceUrl || p.url);

      const doc = {
        name: p.name,
        description: p.description || p.name,
        price: p.price,
        images: p.images.slice(0, 15), // Cap at 15 images to avoid excessive Shopify limits
        shopifyImages: [],
        department,
        category,
        sku: p.sku || `BB-${Date.now()}-${i}`,
        stock: 500,
        specs: { Brand: p.brand, ...p.specs },
        sourceUrl: p.sourceUrl,
        shopifyOptions: p.shopifyOptions || [],
        variants: []
      };

      // Add variants
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

      // 1. Check if already exists in DB
      let existing = await col.findOne({ sourceUrl: p.sourceUrl });
      
      if (!existing) {
        // Fallback check by name and brand
        existing = await col.findOne({ name: p.name, "specs.Brand": p.brand });
      }

      let productId;
      if (existing) {
        productId = existing._id;
        console.log(`  Updating existing DB product: ${productId}`);
        // Retain shopify IDs so we can update Shopify correctly
        doc.shopifyProductId = existing.shopifyProductId;
        doc.shopifyVariantId = existing.shopifyVariantId;
        doc.shopifyHandle = existing.shopifyHandle;
        doc.shopifyProductUrl = existing.shopifyProductUrl;
        doc.shopifyImages = existing.shopifyImages || [];
        
        await col.updateOne({ _id: productId }, { $set: doc });
      } else {
        doc._id = new mongoose.Types.ObjectId();
        productId = doc._id;
        console.log(`  Inserting new DB product: ${productId}`);
        await col.insertOne(doc);
      }

      // Ensure doc has _id for sync
      doc._id = productId;

      // 2. Sync to Shopify
      console.log(`  Syncing to Shopify...`);
      await syncFullProductToShopify(doc, 'Better Bathrooms');
      
      // 3. Wait for Shopify media to process, then get CDN URLs
      await sleep(3000); 
      
      // We must fetch from DB again to get the updated shopifyProductId
      const updatedDoc = await col.findOne({ _id: productId });
      if (updatedDoc && updatedDoc.shopifyProductId) {
         const urlMap = await fetchReadyUrls(updatedDoc.shopifyProductId);
         const newShopifyImages = (updatedDoc.shopifyImages || []).map(img => ({
           ...img,
           shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || ""
         }));
         
         await col.updateOne({ _id: productId }, { $set: { shopifyImages: newShopifyImages } });
         console.log(`  ✓ Shopify sync done. CDN URLs populated: ${newShopifyImages.filter(i=>i.shopifyUrl).length}`);
      }

      successCount++;
    } catch (e) {
      console.error(`  ✗ Error processing ${p.name}:`, e);
      errorCount++;
    }

    // Rate limiting: sleep between products
    await sleep(2000); 
  }

  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`Successfully processed: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  process.exit(0);
}

main().catch(console.error);

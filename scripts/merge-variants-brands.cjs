/*
 * Retired 2026-09-26 — do not run.
 *
 * Every merge this made had to be repaired afterwards:
 *   - `shopifyImages` was deduplicated on `url`, a field the pairs don't have,
 *     so each product kept one image (restore-merged-variant-images.cjs);
 *   - names and Size labels were cut at the first dimension token, "30cm x
 *     60cm" → "30cm", colliding into "(Alt MERGED-Vn)" rows
 *     (fix-merged-product-options.cjs);
 *   - members without `sku` became "MERGED-V1"… on every product
 *     (fix-merged-variant-skus.cjs);
 *   - the variant GIDs from the Shopify sync were never saved, so no variant
 *     could be checked out (sync-merged-products-to-shopify.cjs);
 *   - the members' own Shopify products were left live
 *     (archive-premerge-shopify-products.cjs).
 */
if (!process.argv.includes("--i-know-this-is-broken")) {
  console.error("merge-variants-brands.cjs is retired — see the note at the top of the file.");
  process.exit(1);
}

require("tsx/cjs");
require("dotenv").config({ path: ".env.local" });
const { MongoClient, ObjectId } = require("mongodb");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const CONCURRENCY = 3;

function getBaseName(name) {
  let bn = name;
  bn = bn.replace(/\b(\d+(?:\.\d+)?(?:mm|cm|m|x\d+(?:\.\d+)?(?:mm|cm|m)?|\s*x\s*\d+(?:\.\d+)?(?:mm|cm|m)?))\b/gi, '');
  const colors = ["White", "Black", "Grey", "Anthracite", "Silver", "Gold", "Bronze", "Copper", "Brass", "Chrome", "Beige", "Oak", "Walnut", "Teak", "Blue", "Green", "Red", "Yellow", "Pink", "Matt", "Gloss", "Polished", "Brushed"];
  for (const c of colors) {
    const regex = new RegExp(`\\b${c}\\b`, 'gi');
    bn = bn.replace(regex, '');
  }
  bn = bn.replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Format nicely (Title Case)
  return bn.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

function extractOption(name, isSize) {
  if (isSize) {
    const match = name.match(/\b(\d+(?:\.\d+)?(?:mm|cm|m|x\d+(?:\.\d+)?(?:mm|cm|m)?|\s*x\s*\d+(?:\.\d+)?(?:mm|cm|m)?))\b/i);
    return match ? match[1] : null;
  } else {
    // Extract color/finish
    const colors = ["White", "Black", "Grey", "Anthracite", "Silver", "Gold", "Bronze", "Copper", "Brass", "Chrome", "Beige", "Oak", "Walnut", "Teak", "Blue", "Green", "Red", "Yellow", "Pink", "Matt", "Gloss", "Polished", "Brushed", "Carrara", "Calcatta", "Onyx", "Marble", "Stone"];
    const found = [];
    for (const c of colors) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(name)) found.push(c);
    }
    return found.length ? found.join(" ") : null;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

async function processGroup(key, items, col, index, total) {
  try {
    console.log(`[${index}/${total}] Merging ${items.length} variants for: ${key}`);
    
    // Sort items by price so the lowest is the base price
    items.sort((a, b) => (a.price || 0) - (b.price || 0));
    
    const baseItem = items[0];
    const baseName = getBaseName(baseItem.name) || baseItem.name;
    
    // Determine options
    const sizes = Array.from(new Set(items.map(i => extractOption(i.name, true)).filter(Boolean)));
    const colours = Array.from(new Set(items.map(i => extractOption(i.name, false)).filter(Boolean)));
    
    const options = [];
    if (sizes.length > 0) options.push({ name: 'Size', values: sizes });
    if (colours.length > 0) options.push({ name: 'Colour/Finish', values: colours });
    
    // Build variants array
    const variants = items.map((item, idx) => {
      const size = extractOption(item.name, true) || 'Default Size';
      const colFinish = extractOption(item.name, false) || 'Default Colour';
      
      let opt1, opt2;
      const opts = {};
      if (sizes.length > 0 && colours.length > 0) {
        opt1 = size; opt2 = colFinish;
        opts['Size'] = size;
        opts['Colour/Finish'] = colFinish;
      } else if (sizes.length > 0) {
        opt1 = size;
        opts['Size'] = size;
      } else if (colours.length > 0) {
        opt1 = colFinish;
        opts['Colour/Finish'] = colFinish;
      } else {
        opt1 = `Variant ${idx+1}`;
      }
      
      return {
        _id: item._id, // reuse the original ID for the variant if possible, or new one
        name: item.name,
        sku: item.sku || `${baseItem.sku || 'MERGED'}-V${idx+1}`,
        price: item.price,
        stock: item.stock || 500,
        imageUrl: (item.images && item.images.length > 0) ? item.images[0] : (item.shopifyImages && item.shopifyImages.length > 0 ? item.shopifyImages[0]?.url : null),
        option1: opt1,
        option2: opt2,
        options: opts,
        originalId: item._id // keep track
      };
    });
    
    // Fix non-unique variants
    const seenOpts = new Set();
    for (const v of variants) {
       const key = `${v.option1}|${v.option2}`;
       if (seenOpts.has(key)) {
         v.option1 = `${v.option1} (Alt ${v.sku})`; // force uniqueness
       } else {
         seenOpts.add(key);
       }
    }

    // Collect all unique images
    const allImages = new Set();
    const allShopifyImages = [];
    items.forEach(i => {
      (i.images || []).forEach(img => allImages.add(img));
      (i.shopifyImages || []).forEach(img => allShopifyImages.push(img));
    });
    
    const mergedDoc = {
      ...baseItem,
      _id: baseItem._id,
      name: baseName,
      price: baseItem.price,
      images: Array.from(allImages).slice(0, 15),
      shopifyImages: allShopifyImages.filter((v,i,a)=>a.findIndex(t=>(t.url===v.url))===i).slice(0, 15),
      shopifyOptions: options,
      variants: variants
    };
    
    // 1. Update the base item in DB to become the merged product
    await col.updateOne({ _id: baseItem._id }, { $set: mergedDoc });
    
    // 2. Delete the other original products that are now just variants
    const toDeleteIds = items.slice(1).map(i => i._id);
    if (toDeleteIds.length > 0) {
       await col.deleteMany({ _id: { $in: toDeleteIds } });
    }
    
    // 3. Sync to Shopify
    await syncFullProductToShopify(mergedDoc, 'Tile Script');
    await sleep(3000);
    
    const updatedDoc = await col.findOne({ _id: baseItem._id });
    if (updatedDoc && updatedDoc.shopifyProductId) {
       const urlMap = await fetchReadyUrls(updatedDoc.shopifyProductId);
       const newShopifyImages = (updatedDoc.shopifyImages || []).map(img => ({
         ...img,
         shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || ""
       }));
       await col.updateOne({ _id: baseItem._id }, { $set: { shopifyImages: newShopifyImages } });
    }
    
    return { success: true };
  } catch (e) {
    console.error(`[${index}/${total}] ✗ Error on ${key}:`, e.message);
    return { success: false };
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const db = client.db();
  const col = db.collection("products");

  const brands = [
    "Bathroom 4 Less", "Bathroom4Less", 
    "AL Murad", "Al Murad", 
    "Wall Sandfloors", "Walls and Floors", "Walls & Floors",
    "Total Tiles", 
    "Tiles Porcelain", "Tilesporcelain",
    "Capietra", "Ca' Pietra", "Ca Pietra"
  ];

  const products = await col.find({
    $or: [
      { "specs.Brand": { $in: brands.map(b => new RegExp(b, 'i')) } },
      { sourceUrl: { $regex: new RegExp(brands.join("|").replace(/ /g, ".*"), "i") } }
    ]
  }).toArray();

  const groups = new Map();
  for (const p of products) {
    if (p.variants && p.variants.length > 0) continue;
    const brand = p.specs?.Brand || "Unknown";
    const base = getBaseName(p.name);
    const key = `${brand}|${base}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const validGroups = Array.from(groups.entries()).filter(([k, items]) => items.length > 1);
  console.log(`Starting merge for ${validGroups.length} groups...`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < validGroups.length; i += CONCURRENCY) {
    const batch = validGroups.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((g, idx) => processGroup(g[0], g[1], col, i + idx + 1, validGroups.length)));
    
    for (const r of results) {
      if (r.success) successCount++;
      else errorCount++;
    }
    await sleep(2000); // Rate limit
  }

  console.log(`\n=== MERGE COMPLETE ===`);
  console.log(`Successfully processed: ${successCount} groups`);
  console.log(`Errors: ${errorCount}`);
  await client.close();
  process.exit(0);
}

main().catch(console.error);

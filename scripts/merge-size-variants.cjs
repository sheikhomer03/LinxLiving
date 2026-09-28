/*
 * Retired 2026-09-26 — do not run. It deletes the members' Shopify products
 * and Mongo documents before the merged product is confirmed, and never saves
 * the variant GIDs the Shopify sync returns, so the merged variants cannot be
 * checked out. See the note in merge-variants-brands.cjs.
 */
if (!process.argv.includes("--i-know-this-is-broken")) {
  console.error("merge-size-variants.cjs is retired — see the note at the top of the file.");
  process.exit(1);
}

require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const mongoose = require("mongoose");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

async function fetchReadyUrls(productId) {
  const data = await shopifyAdminRequest(`query { product(id: "${productId}") { media(first: 20) { nodes { id status ... on MediaImage { image { url } } } } } }`);
  const map = {};
  for (const n of data?.product?.media?.nodes || []) {
    if (n.status === "READY" && n.image?.url) map[n.id] = n.image.url;
  }
  return map;
}

async function getMd5(url) {
  try {
    const { execSync } = require("child_process");
    return execSync(`curl -s "${url}" | md5`).toString().trim();
  } catch { return ""; }
}

async function deduplicateImages(urls) {
  const seen = new Set();
  const unique = [];
  for (const url of urls) {
    const h = await getMd5(url);
    if (h && !seen.has(h)) { seen.add(h); unique.push(url); }
  }
  return unique;
}

async function mergeGroup(db, baseName, products) {
  // Sort by size label (parse smallest number first)
  const withSize = products.map(p => {
    const sz = p.specs?.Size || p.specs?.size || "";
    const dims = sz.match(/(\d+)\s*x\s*(\d+)/);
    const area = dims ? parseInt(dims[1]) * parseInt(dims[2]) : 0;
    return { p, sz, area };
  }).sort((a, b) => a.area - b.area);

  const base = withSize[0].p;
  const variants = withSize.map(({ p, sz }) => ({
    _id: new mongoose.Types.ObjectId(),
    name: `${baseName} - ${sz || p.price}`,
    sku: p.sku || p.sourceSku || "",
    price: p.price,
    stock: p.stock || 500,
    imageUrl: p.images?.[0] || "",
    option1: sz || String(p.price),
    options: { Size: sz || String(p.price) }
  }));

  // Collect ALL unique images across variants
  const allImages = [...new Set(products.flatMap(p => p.images || []))];
  const uniqueImages = await deduplicateImages(allImages);

  const newProduct = {
    _id: new mongoose.Types.ObjectId(),
    ...base,
    _id: new mongoose.Types.ObjectId(),
    name: baseName,
    price: variants[0].price,
    images: uniqueImages,
    shopifyImages: [],
    shopifyOptions: [{ name: "Size", values: variants.map(v => v.option1) }],
    variants,
    sourceUrl: base.sourceUrl?.replace(/-\d+mm.*$/, "") || base.sourceUrl
  };
  delete newProduct.shopifyProductId;
  delete newProduct.shopifyVariantId;
  delete newProduct.shopifyHandle;
  delete newProduct.shopifyProductUrl;

  // Delete old individual Shopify products
  for (const p of products) {
    if (p.shopifyProductId) {
      try { await shopifyAdminRequest(`mutation { productDelete(input: { id: "${p.shopifyProductId}" }) { deletedProductId } }`); } catch(e) {}
    }
    await db.collection("products").deleteOne({ _id: p._id });
  }

  await db.collection("products").insertOne(newProduct);
  await syncFullProductToShopify(newProduct, "Tiles Porcelain");

  await new Promise(r => setTimeout(r, 2000));
  const urlMap = await fetchReadyUrls(newProduct.shopifyProductId);
  const newImgs = (newProduct.shopifyImages || []).map(img => ({ ...img, shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || "" }));

  await db.collection("products").updateOne({ _id: newProduct._id }, { $set: {
    shopifyProductId: newProduct.shopifyProductId,
    shopifyVariantId: newProduct.shopifyVariantId,
    shopifyHandle: newProduct.shopifyHandle,
    shopifyProductUrl: newProduct.shopifyProductUrl,
    shopifyImages: newImgs,
    variants: newProduct.variants
  }});

  const cdnFilled = newImgs.filter(i => i.shopifyUrl).length;
  console.log(`  ✓ ${baseName}: ${variants.length} size variants, ${uniqueImages.length} images (${cdnFilled} CDN), ID: ${newProduct._id}`);
  return newProduct._id;
}

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);

  // Get all non-merged TP products
  const all = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain",
    $or: [{ variants: { $exists: false } }, { "variants.1": { $exists: false } }]
  }).toArray();

  // Group by exact name
  const groups = {};
  for (const p of all) {
    if (!groups[p.name]) groups[p.name] = [];
    groups[p.name].push(p);
  }

  // Process only groups with 2+ products
  const toMerge = Object.entries(groups).filter(([, items]) => items.length > 1);
  console.log(`Found ${toMerge.length} groups to merge:`);
  toMerge.forEach(([name, items]) => console.log(`  - "${name}" (${items.length} variants)`));

  for (const [baseName, products] of toMerge) {
    try {
      await mergeGroup(db, baseName, products);
    } catch(e) {
      console.error(`  ✗ Error merging "${baseName}": ${e.message}`);
    }
  }

  console.log("\n✓ All done!");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

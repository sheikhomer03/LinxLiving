require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const mongoose = require("mongoose");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

const BASE = "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807";

// Grout: 3 truly unique images from main product page
const GROUT_CORRECT_IMAGES = [
  `${BASE}/g/r/grt-spkz.jpg`,
  `${BASE}/g/o/gold-glitter-150g.jpg`,
  `${BASE}/s/i/silver-glitter-150g.jpg`,
];

async function getMd5(url) {
  try {
    const { execSync } = require("child_process");
    return execSync(`curl -s "${url}" | md5`).toString().trim();
  } catch { return null; }
}

async function getUniqueImages(urls) {
  const seen = new Set();
  const unique = [];
  for (const url of urls) {
    const hash = await getMd5(url);
    if (hash && !seen.has(hash)) {
      seen.add(hash);
      unique.push(url);
    }
  }
  return unique;
}

async function fetchReadyUrls(productId) {
  const data = await shopifyAdminRequest(`
    query { product(id: "${productId}") { media(first: 50) { nodes { id status ... on MediaImage { image { url } } } } } }
  `);
  const map = {};
  for (const n of data?.product?.media?.nodes || []) {
    if (n.status === "READY" && n.image?.url) map[n.id] = n.image.url;
  }
  return map;
}

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);

  // ── 1. Fix Epoxy Grout: use the 3 true unique images ──────────────────────
  console.log("\n── Epoxy Grout and Glitter ──");
  const grout = await db.collection("products").findOne({ name: "Epoxy Grout and Glitter", "specs.Brand": "Tilesporcelain" });
  if (grout) {
    // Rebuild shopifyImages from Shopify (it was uploaded with 6 dupes)
    // Delete current Shopify product and re-upload with 3 correct images
    if (grout.shopifyProductId) {
      try { await shopifyAdminRequest(`mutation { productDelete(input: { id: "${grout.shopifyProductId}" }) { deletedProductId } }`); } catch(e) {}
    }
    await db.collection("products").deleteOne({ _id: grout._id });

    // Re-create using syncFullProductToShopify with corrected images
    const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
    const GROUT_COLORS = ["Black", "Brown", "Cream", "Purple", "Pink", "Red"];
    const newGrout = {
      _id: new mongoose.Types.ObjectId(),
      name: "Epoxy Grout and Glitter",
      description: "Add your epoxy grout and glitter to get the grout and sparkle colour you desire. Available in 6 colours. Coverage approx 5m².",
      price: 29.99,
      images: GROUT_CORRECT_IMAGES,
      shopifyImages: [],
      department: "tiles",
      category: "glitter-grout",
      sku: "grt-spkz",
      stock: 500,
      specs: { Brand: "Tilesporcelain", Type: "Epoxy Grout", Coverage: "Approx 5m²" },
      sourceUrl: "https://tilesporcelain.co.uk/epoxy-grout-and-glitter",
      shopifyOptions: [{ name: "Colour", values: GROUT_COLORS }],
      variants: GROUT_COLORS.map(colour => ({
        _id: new mongoose.Types.ObjectId(),
        name: `Epoxy Grout and Glitter - ${colour}`,
        sku: `grt-spkz-${colour}-1`,
        price: 29.99,
        stock: 500,
        imageUrl: GROUT_CORRECT_IMAGES[0],
        option1: colour,
        options: { Colour: colour }
      }))
    };
    await db.collection("products").insertOne(newGrout);
    await syncFullProductToShopify(newGrout, "Tiles Porcelain");
    await new Promise(r => setTimeout(r, 3000));
    const urlMap = await fetchReadyUrls(newGrout.shopifyProductId);
    const newImgs = (newGrout.shopifyImages || []).map(img => ({ ...img, shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || "" }));
    await db.collection("products").updateOne({ _id: newGrout._id }, { $set: {
      shopifyProductId: newGrout.shopifyProductId, shopifyVariantId: newGrout.shopifyVariantId,
      shopifyHandle: newGrout.shopifyHandle, shopifyProductUrl: newGrout.shopifyProductUrl,
      shopifyImages: newImgs, variants: newGrout.variants
    }});
    console.log(`✓ Grout: ${newImgs.filter(i=>i.shopifyUrl).length}/3 CDN images, ID: ${newGrout._id}`);
  }

  // ── 2. Fix the 3 tile products with size variants ─────────────────────────
  const tileProducts = [
    { id: "6ab6410e95fd1ec7399dde61", name: "Alaska White Matt Porcelain Tiles" },
    { id: "6ab6411695fd1ec7399dde64", name: "Bali Gold Beige Grey Matt R11 Porcelain Tiles" },
    { id: "6ab6411e95fd1ec7399dde68", name: "Diamond White Sparkly Quartz Tiles" },
  ];

  for (const tp of tileProducts) {
    console.log(`\n── ${tp.name} ──`);
    const p = await db.collection("products").findOne({ _id: new mongoose.Types.ObjectId(tp.id) });
    if (!p) { console.log("Not found!"); continue; }

    // Get unique images by deduplicating via MD5
    const allImages = p.images || [];
    console.log(`  Raw images: ${allImages.length}`);
    const uniqueImages = await getUniqueImages(allImages);
    console.log(`  Unique images: ${uniqueImages.length}`);

    if (uniqueImages.length < allImages.length) {
      // Fetch current CDN URL map
      const urlMap = await fetchReadyUrls(p.shopifyProductId);
      // Filter shopifyImages to only the ones corresponding to unique source images
      const newShopifyImages = (p.shopifyImages || []).filter((img, idx) => {
        return uniqueImages.includes(img.sourceUrl);
      }).map(img => ({ ...img, shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || "" }));

      await db.collection("products").updateOne(
        { _id: p._id },
        { $set: { images: uniqueImages, shopifyImages: newShopifyImages } }
      );
      console.log(`  ✓ Fixed: ${uniqueImages.length} unique images, ${newShopifyImages.filter(i=>i.shopifyUrl).length} CDN URLs`);
    } else {
      // Just make sure CDN URLs are populated
      const urlMap = await fetchReadyUrls(p.shopifyProductId);
      const newShopifyImages = (p.shopifyImages || []).map(img => ({
        ...img, shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || ""
      }));
      await db.collection("products").updateOne({ _id: p._id }, { $set: { shopifyImages: newShopifyImages } });
      console.log(`  ✓ Already unique: ${uniqueImages.length} images, CDN URLs refreshed`);
    }
  }

  console.log("\n✓ All done!");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

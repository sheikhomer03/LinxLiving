require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const mongoose = require("mongoose");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

// One real image per colour, directly from the live site
const GROUT_COLORS = [
  { colour: "Black",  sku: "grt-spkz-Black-1",  image: "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_3_1.jpg" },
  { colour: "Brown",  sku: "grt-spkz-Brown-1",  image: "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_4_1.jpg" },
  { colour: "Cream",  sku: "grt-spkz-Cream-1",  image: "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_6_1.jpg" },
  { colour: "Purple", sku: "grt-spkz-Purple-1", image: "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_8_1.jpg" },
  { colour: "Pink",   sku: "grt-spkz-Pink-1",   image: "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_9_1.jpg" },
  { colour: "Red",    sku: "grt-spkz-Red-1",    image: "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_1_1.jpg" },
];

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);

  // Delete existing
  const existing = await db.collection("products").find({ "specs.Brand": "Tilesporcelain", name: /Epoxy Grout and Glitter/ }).toArray();
  console.log(`Cleaning ${existing.length} old grout products...`);
  for (const p of existing) {
    if (p.shopifyProductId) {
      try { await shopifyAdminRequest(`mutation { productDelete(input: { id: "${p.shopifyProductId}" }) { deletedProductId } }`); } catch(e) {}
    }
    await db.collection("products").deleteOne({ _id: p._id });
  }

  // Build product with 6 unique images (one per colour) + shopifyOptions for selector
  const product = {
    _id: new mongoose.Types.ObjectId(),
    name: "Epoxy Grout and Glitter",
    description: "Add your epoxy grout and glitter to get the grout and sparkle colour you desire. Available in 6 colours. Coverage approx 5m².",
    price: 29.99,
    images: GROUT_COLORS.map(c => c.image), // 6 distinct images
    shopifyImages: [],
    department: "tiles",
    category: "glitter-grout",
    sku: "grt-spkz",
    stock: 500,
    specs: { Brand: "Tilesporcelain", Type: "Epoxy Grout", Coverage: "Approx 5m²" },
    sourceUrl: "https://tilesporcelain.co.uk/epoxy-grout-and-glitter",
    shopifyOptions: [{ name: "Colour", values: GROUT_COLORS.map(c => c.colour) }],
    variants: GROUT_COLORS.map(c => ({
      _id: new mongoose.Types.ObjectId(),
      name: `Epoxy Grout and Glitter - ${c.colour}`,
      sku: c.sku,
      price: 29.99,
      stock: 500,
      imageUrl: c.image,  // unique image per colour
      option1: c.colour,
      options: { Colour: c.colour }
    }))
  };

  await db.collection("products").insertOne(product);
  console.log("Inserted:", product._id.toString());

  await syncFullProductToShopify(product, "Tiles Porcelain");
  console.log("Synced to Shopify. Images:", product.shopifyImages?.length);

  // Wait for Shopify to process images then fetch real CDN URLs
  await new Promise(r => setTimeout(r, 4000));
  const mediaData = await shopifyAdminRequest(`query { product(id: "${product.shopifyProductId}") { media(first: 20) { nodes { id status ... on MediaImage { image { url } } } } } }`);
  const urlMap = {};
  for (const n of mediaData?.product?.media?.nodes || []) {
    if (n.status === "READY" && n.image?.url) urlMap[n.id] = n.image.url;
  }

  const newShopifyImages = (product.shopifyImages || []).map(img => ({
    ...img,
    shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || ""
  }));

  await db.collection("products").updateOne(
    { _id: product._id },
    { $set: {
      shopifyProductId: product.shopifyProductId,
      shopifyVariantId: product.shopifyVariantId,
      shopifyHandle: product.shopifyHandle,
      shopifyProductUrl: product.shopifyProductUrl,
      shopifyImages: newShopifyImages,
      variants: product.variants
    }}
  );

  const filled = newShopifyImages.filter(i => i.shopifyUrl).length;
  console.log(`✓ Done! ${filled}/${newShopifyImages.length} images have CDN URLs`);
  console.log("Visit: http://localhost:3000/products/" + product._id.toString());
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

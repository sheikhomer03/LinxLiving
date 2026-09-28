require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

async function fetchReadyUrls(productId) {
  const data = await shopifyAdminRequest(`
    query { product(id: "${productId}") { media(first: 50) { nodes { id status ... on MediaImage { image { url } } } } } }
  `);
  const map = {};
  for (const node of data?.product?.media?.nodes || []) {
    if (node.status === "READY" && node.image?.url) map[node.id] = node.image.url;
  }
  return map;
}

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);

  // Find all TP products that have any empty shopifyUrl
  const products = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain",
    shopifyProductId: { $exists: true, $ne: "" },
    "shopifyImages": { $elemMatch: { shopifyUrl: "" } }
  }).toArray();

  console.log(`Found ${products.length} products with empty shopifyUrls`);

  let fixed = 0, failed = 0;
  for (const p of products) {
    try {
      const urlMap = await fetchReadyUrls(p.shopifyProductId);
      if (!Object.keys(urlMap).length) { failed++; continue; }

      const newImages = (p.shopifyImages || []).map(img => ({
        ...img,
        shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || ""
      }));

      const newVariants = (p.variants || []).map(v => ({
        ...v,
        shopifyImageUrl: urlMap[v.shopifyMediaId] || v.shopifyImageUrl || ""
      }));

      const anyFixed = newImages.some((img, i) => img.shopifyUrl && !(p.shopifyImages[i]?.shopifyUrl));
      if (anyFixed) {
        await db.collection("products").updateOne(
          { _id: p._id },
          { $set: { shopifyImages: newImages, variants: newVariants } }
        );
        fixed++;
        console.log(`✓ ${p.name} — ${newImages.filter(i => i.shopifyUrl).length}/${newImages.length} images`);
      } else {
        failed++;
        console.log(`✗ ${p.name} — still processing on Shopify`);
      }
    } catch(e) {
      failed++;
      console.log(`✗ Error for ${p.name}: ${e.message}`);
    }
  }

  console.log(`\nFixed: ${fixed}, Still pending: ${failed}`);
  process.exit(0);
}
main().catch(console.error);

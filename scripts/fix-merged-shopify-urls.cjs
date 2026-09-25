require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

async function fetchShopifyProductImages(productId) {
  const data = await shopifyAdminRequest(`
    query {
      product(id: "${productId}") {
        media(first: 50) {
          nodes { 
            id 
            status 
            ... on MediaImage {
              image { url }
            }
          }
        }
      }
    }
  `);
  return data?.product?.media?.nodes || [];
}

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  
  // Find all products with shopifyProductId but empty shopifyUrls
  const products = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain",
    shopifyProductId: { $exists: true },
    "shopifyImages.shopifyUrl": ""
  }).toArray();
  
  console.log(`Found ${products.length} products with empty shopifyUrls`);
  
  for (const product of products) {
    try {
      const shopifyMedia = await fetchShopifyProductImages(product.shopifyProductId);
      if (!shopifyMedia.length) {
        console.log(`No media for ${product.name}`);
        continue;
      }
      
      // Build map: mediaId -> CDN url
      const mediaMap = {};
      for (const node of shopifyMedia) {
        if (node.status === "READY" && node.image?.url) {
          mediaMap[node.id] = node.image.url;
        }
      }
      
      // Update shopifyImages with real URLs
      let updated = false;
      const newShopifyImages = (product.shopifyImages || []).map(img => {
        const url = mediaMap[img.mediaId];
        if (url && !img.shopifyUrl) {
          updated = true;
          return { ...img, shopifyUrl: url };
        }
        return img;
      });
      
      // Also update variant shopifyImageUrls
      const newVariants = (product.variants || []).map(v => {
        const url = mediaMap[v.shopifyMediaId];
        if (url && !v.shopifyImageUrl) {
          return { ...v, shopifyImageUrl: url };
        }
        return v;
      });
      
      if (updated) {
        await db.collection("products").updateOne(
          { _id: product._id },
          { $set: { shopifyImages: newShopifyImages, variants: newVariants } }
        );
        console.log(`✓ Fixed ${product.name} — ${newShopifyImages.filter(i => i.shopifyUrl).length} images`);
      } else {
        console.log(`- ${product.name}: No READY images yet`);
      }
    } catch(e) {
      console.error(`✗ Error for ${product.name}:`, e.message);
    }
  }
  
  console.log("Done!");
  process.exit(0);
}
main().catch(console.error);

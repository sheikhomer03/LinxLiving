const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const fetch = require("node-fetch");
const { connectMongo } = require("./mongo-connect.cjs");
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  return data.access_token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function queryShopify(query, variables = {}, token) {
  const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    if (json.errors[0]?.extensions?.code === 'THROTTLED') {
      await sleep(2000);
      return queryShopify(query, variables, token);
    }
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

async function main() {
  console.log("Fetching sitemap...");
  const sitemapRes = await fetch("https://tilesporcelain.co.uk/tilesporcelainsitemap.xml");
  const sitemapText = await sitemapRes.text();
  
  // Extract URLs and images from sitemap using regex
  // <loc>url</loc> followed by multiple <image:loc>img_url</image:loc>
  const urlBlocks = sitemapText.split("<url>");
  const sitemapMap = new Map();
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (!locMatch) continue;
    const loc = locMatch[1];
    const imageLocs = [...block.matchAll(/<image:loc>(.*?)<\/image:loc>/g)].map(m => m[1]);
    sitemapMap.set(loc, imageLocs);
    // Also map by slug
    const slug = loc.split("/").pop();
    sitemapMap.set(slug, imageLocs);
  }
  console.log(`Parsed ${sitemapMap.size} URLs from sitemap.`);

  const token = await adminToken();
  const { db: primary } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  
  const brand = await primary.collection('brands').findOne({ slug: 'tiles-porcelain' });
  
  const badProducts = await conn.db.collection('products').find({
    brand: brand._id,
    'shopifyImages.0': { $exists: false },
    shopifyProductId: { $nin: [null, ""] }
  }).toArray();
  
  console.log(`Found ${badProducts.length} broken products to fix.`);
  
  let fixed = 0;
  for (const p of badProducts) {
    const slug = p.sourceUrl ? p.sourceUrl.split("/").pop() : p.slug;
    const newImages = sitemapMap.get(slug) || sitemapMap.get(p.sourceUrl);
    
    if (!newImages || newImages.length === 0) {
      console.log(`Warning: No images found in sitemap for ${p.sourceUrl}`);
      continue;
    }
    
    // Delete from Shopify
    if (p.shopifyProductId) {
      try {
        await queryShopify(`
          mutation($input: ProductDeleteInput!) {
            productDelete(input: $input) {
              deletedProductId
              userErrors { field message }
            }
          }
        `, { input: { id: p.shopifyProductId } }, token);
        await sleep(150);
      } catch (err) {
        console.error(`Failed to delete ${p.shopifyProductId} from Shopify:`, err.message);
      }
    }
    
    // Update MongoDB
    await conn.db.collection('products').updateOne(
      { _id: p._id },
      {
        $set: { images: newImages },
        $unset: { shopifyProductId: "", shopifyVariantId: "", shopifyImages: "", shopifySyncError: "" }
      }
    );
    fixed++;
    process.stdout.write(`\rFixed ${fixed}/${badProducts.length}...`);
  }
  
  console.log(`\nSuccessfully fixed ${fixed} products! You can now run the sync script.`);
  
  await conn.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

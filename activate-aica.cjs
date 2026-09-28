const path = require("path");
const fs = require("fs");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}
const { connectMongo } = require("./scripts/mongo-connect.cjs");

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
let token = null;

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
  const j = await res.json();
  if (!j.access_token) throw new Error("token exchange failed");
  return j.access_token;
}

async function admin(query, variables, attempt = 0) {
  try {
    const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
    return j.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

async function main() {
  token = await adminToken();
  const { db, mongoose } = await connectMongo(); // DB1
  const brand = await db.collection("brands").findOne({ name: "Aica Bathrooms" });
  
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  const products = await db2.collection("products").find({
    brand: brand._id,
    shopifyProductId: { $exists: true, $ne: null }
  }).toArray();
  
  console.log(`Found ${products.length} products to activate on Shopify...`);
  
  let success = 0;
  let failed = 0;
  
  const worker = async () => {
    while (products.length > 0) {
      const p = products.pop();
      try {
        await admin(`
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id status }
              userErrors { field message }
            }
          }
        `, {
          input: {
            id: p.shopifyProductId,
            status: "ACTIVE"
          }
        });
        success++;
        if (success % 50 === 0) console.log(`Activated ${success} products...`);
      } catch (err) {
        failed++;
      }
    }
  };
  
  await Promise.all(Array.from({ length: 10 }, worker));
  
  console.log(`Finished! Activated: ${success}, Failed: ${failed}`);
  
  await mongoose2.disconnect();
  await mongoose.disconnect();
}

main().catch(console.error);

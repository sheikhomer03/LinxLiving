const path = require("path");
const fs = require("fs");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}
const mongoose = require("mongoose");

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
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

async function main() {
  token = await adminToken();
  const conn1 = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
  const conn2 = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 15000 }).asPromise();
  
  const brand = await conn1.db.collection('brands').findOne({ slug: 'total-tiles' });
  
  const pending = await conn2.db.collection('products')
    .find({ brand: brand._id, 'shopifyImages.0': { $exists: false } })
    .project({ shopifyProductId: 1, name: 1 })
    .limit(3)
    .toArray();
    
  if (!pending.length) { console.log('No pending products.'); process.exit(0); }
  
  for (const p of pending) {
    console.log('\nChecking product:', p.name);
    const data = await admin(
      `query GetMediaStatus($id: ID!) {
        product(id: $id) {
          media(first: 20) {
            nodes {
              id
              status
              mediaErrors { code details message }
            }
          }
        }
      }`,
      { id: p.shopifyProductId }
    );
    console.log(JSON.stringify(data.product.media.nodes, null, 2));
  }
  
  await conn1.close();
  await conn2.close();
  process.exit(0);
}
main().catch(console.error);

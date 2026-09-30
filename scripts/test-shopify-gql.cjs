const { connectMongo } = require('./mongo-connect.cjs');
const mongoose = require('mongoose');

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
  const j = await res.json();
  return j.access_token;
}

async function run() {
  const token = await adminToken();
  const { db } = await connectMongo();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const col = conn.db.collection('products');
  
  const sample = await col.findOne({ name: 'Pontus Round Thermostatic Shower Pack', brand: brand._id });
  console.log('Shopify ID:', sample.shopifyProductId);
  
  const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ 
        query: `query { node(id: "${sample.shopifyProductId}") { ... on Product { media(first: 30) { nodes { id ... on MediaImage { image { url } } } } } } }`
      }),
  });
  const j = await res.json();
  console.log(JSON.stringify(j.data.node.media.nodes, null, 2));
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

const path = require("path");
const fs = require("fs");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}
const { connectMongo } = require("./scripts/mongo-connect.cjs");
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2024-04";

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
  return j.access_token;
}

async function admin(query, variables) {
  const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 500));
  return j.data;
}

async function testProductSet() {
  token = await adminToken();
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  const brand = await db.collection("brands").findOne({ name: "Aica Bathrooms" });
  
  const products = await db2.collection("products").find({ 
    brand: brand._id,
    $expr: { $gt: [{ $size: "$variants" }, 1] } 
  }).limit(1).toArray();
  const p = products[0];
  
  console.log("Testing on:", p.name, p.shopifyProductId);
  
  // 1. Gather all option names
  const optionNames = new Set();
  for (const v of p.variants) {
    if (v.options) {
      for (const key of Object.keys(v.options)) {
        optionNames.add(key);
      }
    }
  }
  
  const optionsArr = Array.from(optionNames).map(name => ({
    name,
    values: Array.from(new Set(p.variants.map(v => v.options[name]).filter(Boolean))).map(val => ({ name: val }))
  }));
  
  const variantInputs = p.variants.map(v => {
    const optionValues = Array.from(optionNames).map(name => {
      return { 
        name: String(v.options[name] || "Default").slice(0, 255), 
        optionName: name 
      };
    });
    
    return {
      price: String(Number(v.price).toFixed(2)),
      optionValues: optionValues,
      inventoryItem: v.sku ? { sku: v.sku } : undefined
    };
  });
  
  const query = `
    mutation productSet($input: ProductSetInput!) {
      productSet(input: $input) {
        product { id variants(first: 5) { nodes { id title price } } }
        userErrors { field message }
      }
    }
  `;
  
  const variables = {
    input: {
      id: p.shopifyProductId,
      productOptions: optionsArr,
      variants: variantInputs
    }
  };
  
  try {
    const result = await admin(query, variables);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err.message);
  }

  process.exit(0);
}

testProductSet().catch(err => {
  console.error(err);
  process.exit(1);
});

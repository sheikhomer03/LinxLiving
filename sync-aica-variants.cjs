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

async function admin(query, variables, attempt = 0) {
  try {
    const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 500));
    return j.data;
  } catch (err) {
    if (attempt >= 5) throw err;
    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

async function syncVariants() {
  token = await adminToken();
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  const brand = await db.collection("brands").findOne({ name: "Aica Bathrooms" });
  
  const products = await db2.collection("products").find({ 
    brand: brand._id,
    shopifyProductId: { $exists: true, $ne: null },
    $expr: { $gt: [{ $size: "$variants" }, 1] } 
  }).toArray();
  
  console.log(`Found ${products.length} multi-variant products to sync.`);
  
  let success = 0;
  let failed = 0;
  
  const query = `
    mutation productSet($input: ProductSetInput!) {
      productSet(input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `;
  
  const worker = async () => {
    while (products.length > 0) {
      const p = products.pop();
      try {
        const optionNames = new Set();
        for (const v of p.variants) {
          if (v.options) {
            for (const key of Object.keys(v.options)) optionNames.add(key);
          }
        }
        
        if (optionNames.size === 0) {
           console.log("No options for", p.name);
           continue; // skip if no options
        }
        
        const optionsArr = Array.from(optionNames).map(name => {
          let vals = Array.from(new Set(p.variants.map(v => v.options[name]).filter(Boolean))).map(val => ({ name: String(val).slice(0, 255) }));
          if (vals.length === 0) vals = [{ name: "Default" }];
          return { name, values: vals };
        });
        
        // Shopify allows up to 100 variants
        const variantsToSync = p.variants.slice(0, 100);
        
        const variantInputs = variantsToSync.map(v => {
          const optionValues = Array.from(optionNames).map(name => ({ 
            name: String(v.options[name] || "Default").slice(0, 255), 
            optionName: name 
          }));
          
          const vInput = {
            price: String(Number(v.price).toFixed(2)),
            optionValues: optionValues,
            inventoryPolicy: "CONTINUE"
          };
          if (v.sku) vInput.inventoryItem = { sku: v.sku };
          if (v.compareAtPrice) vInput.compareAtPrice = String(Number(v.compareAtPrice).toFixed(2));
          return vInput;
        });
        
        const variables = {
          input: {
            id: p.shopifyProductId,
            productOptions: optionsArr,
            variants: variantInputs
          }
        };
        
        const result = await admin(query, variables);
        if (result.productSet && result.productSet.userErrors && result.productSet.userErrors.length > 0) {
           console.log(`Failed ${p.name}:`, result.productSet.userErrors);
           failed++;
        } else {
           success++;
           if (success % 20 === 0) console.log(`Synced ${success} products...`);
        }
      } catch (err) {
        console.log(`Failed ${p.name}:`, err.message);
        failed++;
      }
    }
  };
  
  await Promise.all(Array.from({ length: 10 }, worker));
  
  console.log(`Finished variant sync! Success: ${success}, Failed: ${failed}`);

  await mongoose2.disconnect();
  await mongoose.disconnect();
}

syncVariants().catch(err => {
  console.error(err);
  process.exit(1);
});

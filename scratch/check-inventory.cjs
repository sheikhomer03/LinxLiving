const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const col = conn.db.collection('products');
  
  const p = await col.findOne({ _id: new mongoose.Types.ObjectId("6ab6178f3425de2945146096") });
  
  const q = `query {
    product(id: "${p.shopifyProductId}") {
      variants(first: 1) {
        nodes {
          id
          inventoryQuantity
          inventoryItem {
            id
            inventoryLevels(first: 1) {
              nodes {
                id
                quantities(names: ["available"]) { name quantity }
                location { id name }
              }
            }
          }
        }
      }
    }
  }`;
  
  const res = await fetch(`https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN },
    body: JSON.stringify({ query: q })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

const { connectMongo } = require('../scripts/mongo-connect.cjs');
const mongoose = require('mongoose');

async function run() {
  const { db } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  const brand = await db.collection('brands').findOne({ name: 'Tiles Porcelain' });
  const col = conn.db.collection('products');
  
  const products = await col.find({ brand: brand._id, shopifyImages: { $exists: false } }).toArray();
  
  for (const p of products) {
    try {
      const q = `query { productByHandle(handle: "${p.slug}") { id } }`;
      const res = await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN },
        body: JSON.stringify({ query: q })
      });
      const data = await res.json();
      const id = data.data?.productByHandle?.id;
      
      if (id) {
        await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/api/2024-01/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN },
          body: JSON.stringify({ query: `mutation { productDelete(input: { id: "${id}" }) { deletedProductId } }` })
        });
        process.stdout.write('x');
      } else {
        process.stdout.write('?');
      }
    } catch(e) {
      process.stdout.write('!');
    }
  }
  
  console.log('\nDone deleting by handle');
  await conn.close();
  process.exit(0);
}
require('dotenv').config({ path: '.env.local' });
run();

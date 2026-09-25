const path = require('path');
const fs = require('fs');
require('dotenv').config({path: path.join(__dirname, '..', '.env.local')});
const mongoose = require('mongoose');
const { connectMongo } = require('./mongo-connect.cjs');

(async () => {
  const { db: primary } = await connectMongo();
  const brand = await primary.collection('brands').findOne({ slug: 'tiles-porcelain' });
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  const col = conn.db.collection('products');
  
  const products = await col.find({ brand: brand._id }).toArray();
  console.log(`Found ${products.length} products`);
  
  // Group by base name
  const groups = new Map();
  for (const p of products) {
    // If the name ends in e.g. "-300x300", strip it.
    let baseName = p.name.trim();
    const match = baseName.match(/^(.*?)\s*-\s*[\dxXmmcm\s]+$/i);
    if (match) baseName = match[1].trim();
    
    if (!groups.has(baseName)) groups.set(baseName, []);
    groups.get(baseName).push(p);
  }
  
  let multiGroups = 0;
  for (const [base, items] of groups) {
    if (items.length > 1) {
      multiGroups++;
      if (base.includes('Diamond White Sparkly Quartz')) {
        console.log(`\nGroup: ${base} (${items.length})`);
        items.forEach(i => console.log(`  - ${i.name} [£${i.price}] - Size: ${i.specs?.Size || 'N/A'}`));
      }
    }
  }
  
  console.log(`\nTotal multi-size families: ${multiGroups}`);
  
  await conn.close();
  process.exit(0);
})();

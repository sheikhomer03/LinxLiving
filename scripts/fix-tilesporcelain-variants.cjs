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
    let baseName = p.name.replace(/\b\d+\s*[xX]\s*\d+(\s*[xX]\s*\d+)?\s*(mm|cm)?\b/gi, '').replace(/\s*-\s*/, '').replace(/\s+/g, ' ').trim();
    let size = p.specs?.Size || "";
    
    // If we couldn't find a Size spec, try to pull it from the name
    if (!size) {
      const sizeMatch = p.name.match(/\b(\d+\s*[xX]\s*\d+(\s*[xX]\s*\d+)?\s*(mm|cm)?)\b/i);
      if (sizeMatch) size = sizeMatch[1].trim();
    }
    
    // Attach derived properties for grouping
    p._baseName = baseName;
    p._size = size;
    
    if (!groups.has(baseName)) groups.set(baseName, []);
    groups.get(baseName).push(p);
  }
  
  const ops = [];
  let updatedProducts = 0;
  
  for (const [base, items] of groups) {
    if (items.length > 1) {
      // Create the variantSiblings array for this family
      const siblingsMap = items.map(i => ({
        id: String(i._id),
        name: i.name,
        colour: i.specs?.Colour || i.specs?.Color || "",
        size: i._size || i.specs?.Size || "",
        price: i.price,
        image: (i.images || [])[0] || ""
      }));
      
      // Update each item in the family
      for (const item of items) {
        // Exclude self from siblings array
        const mySiblings = siblingsMap.filter(s => s.id !== String(item._id));
        
        ops.push({
          updateOne: {
            filter: { _id: item._id, brand: brand._id },
            update: { 
              $set: { 
                "specs.variantSiblings": mySiblings,
                "specs.Size": item._size // Ensure Size exists in specs
              } 
            }
          }
        });
        updatedProducts++;
      }
    }
  }
  
  console.log(`Prepared to update ${updatedProducts} products across multi-size families.`);
  
  console.log('Sample groups:', Array.from(groups.keys()).slice(0, 20)); if (ops.length > 0) {
    // Bulk execute the updates
    for (let i = 0; i < ops.length; i += 300) {
      await col.bulkWrite(ops.slice(i, i + 300), { ordered: false });
    }
    console.log(`Successfully linked variants for ${updatedProducts} products!`);
  } else {
    console.log("No multi-size families found to link.");
  }
  
  await conn.close();
  process.exit(0);
})();

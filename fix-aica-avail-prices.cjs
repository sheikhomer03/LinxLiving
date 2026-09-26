require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');
const fs = require('fs');

async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  // Load JSONL
  const jsonl = fs.readFileSync('.scratch/aica/aica-pdp.jsonl', 'utf-8').split('\n').filter(Boolean);
  const pdpMap = new Map();
  for (const line of jsonl) {
    try {
      const p = JSON.parse(line);
      if (p.sourceUrl) pdpMap.set(p.sourceUrl, p);
    } catch (e) {}
  }
  
  const brand = await db.collection('brands').findOne({ name: 'Aica Bathrooms' });
  const products = await db2.collection('products').find({ brand: brand._id }).toArray();
  
  console.log(`Updating ${products.length} Aica products...`);
  let fixedCount = 0;

  for (const p of products) {
    const scraped = pdpMap.get(p.sourceUrl);
    if (!scraped) continue;
    
    let hasChanges = false;
    
    // Update top level availability
    let updateDoc = {
      isOutOfStock: false,
      stockStatus: "in_stock"
    };
    
    // Process variants
    const newVariants = p.variants.map(v => {
      const newV = { ...v, available: true };
      
      // Find matching variant in scraped data
      let scrapedVariant = null;
      if (scraped.variants) {
        if (v.sku) {
          scrapedVariant = scraped.variants.find(sv => sv.sku === v.sku);
        }
        if (!scrapedVariant) {
          // fallback to name/title
          scrapedVariant = scraped.variants.find(sv => sv.title && sv.title.toLowerCase().trim() === v.name.toLowerCase().trim());
        }
      }
      
      if (scrapedVariant && scrapedVariant.compareAtPrice != null) {
        newV.compareAtPrice = scrapedVariant.compareAtPrice;
      } else {
         // fallback if JSON didn't have it but v.price is valid
         // If Aica usually does ~ 40% discount, we could guess, but let's just stick to what we scraped.
      }
      return newV;
    });
    
    updateDoc.variants = newVariants;
    
    // Update top-level compareAtPrice
    const comparePrices = newVariants.map(v => v.compareAtPrice).filter(x => x != null && x > 0);
    if (comparePrices.length > 0) {
      updateDoc.compareAtPrice = Math.min(...comparePrices);
    }
    
    await db2.collection('products').updateOne({ _id: p._id }, { $set: updateDoc });
    fixedCount++;
  }
  
  console.log(`Done! Updated ${fixedCount} products in DB.`);
  
  await mongoose2.disconnect();
  await mongoose.disconnect();
}

run().catch(console.error);

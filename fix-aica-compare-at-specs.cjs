require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');

async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  const brand = await db.collection('brands').findOne({ name: 'Aica Bathrooms' });
  const products = await db2.collection('products').find({ brand: brand._id }).toArray();
  
  console.log(`Fixing compareAtPrice for ${products.length} Aica products...`);
  
  let fixedCount = 0;
  const bulkOps = [];

  for (const p of products) {
    const updateSet = {};
    const updateUnset = {};
    
    // Copy top-level compareAtPrice into specs.compareAtPrice so the product page can find it
    if (p.compareAtPrice != null && p.compareAtPrice > 0) {
      updateSet['specs.compareAtPrice'] = p.compareAtPrice;
    }
    
    // Also copy per-variant compareAtPrice into specs (for variant-level pricing)
    // Clear any erroneous salePercent that may be causing wrong calculations
    if (p.specs && p.specs.salePercent != null) {
      updateUnset['specs.salePercent'] = '';
    }
    
    // Make sure salePriceMode is not set to raise-then-percent (which would ignore compareAtPrice)
    if (p.specs && p.specs.salePriceMode) {
      updateUnset['specs.salePriceMode'] = '';
    }

    if (Object.keys(updateSet).length > 0 || Object.keys(updateUnset).length > 0) {
      const op = { updateOne: { filter: { _id: p._id }, update: {} } };
      if (Object.keys(updateSet).length > 0) op.updateOne.update.$set = updateSet;
      if (Object.keys(updateUnset).length > 0) op.updateOne.update.$unset = updateUnset;
      bulkOps.push(op);
    }
  }
  
  if (bulkOps.length > 0) {
    const result = await db2.collection('products').bulkWrite(bulkOps, { ordered: false });
    console.log(`Bulk updated ${result.modifiedCount} products`);
  }
  
  fixedCount = bulkOps.length;
  console.log(`Done! Updated ${fixedCount} products.`);
  
  await mongoose2.disconnect();
  await mongoose.disconnect();
}

run().catch(console.error);

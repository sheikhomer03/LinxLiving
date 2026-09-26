require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');

async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  const brand = await db.collection('brands').findOne({ name: 'Aica Bathrooms' });
  const products = await db2.collection('products').find({ brand: brand._id }).toArray();
  
  console.log(`Dividing prices by 1.2 for ${products.length} Aica products...`);
  let fixedCount = 0;

  for (const p of products) {
    let hasChanges = false;
    const updateDoc = {};
    
    if (p.price) {
      updateDoc.price = Number((p.price / 1.2).toFixed(2));
      hasChanges = true;
    }
    
    if (p.compareAtPrice) {
      updateDoc.compareAtPrice = Number((p.compareAtPrice / 1.2).toFixed(2));
      hasChanges = true;
    }
    
    if (p.variants && p.variants.length > 0) {
      const newVariants = p.variants.map(v => {
        const newV = { ...v };
        if (newV.price != null) {
          newV.price = Number((newV.price / 1.2).toFixed(2));
        }
        if (newV.compareAtPrice != null) {
          newV.compareAtPrice = Number((newV.compareAtPrice / 1.2).toFixed(2));
        }
        return newV;
      });
      updateDoc.variants = newVariants;
      hasChanges = true;
    }
    
    if (hasChanges) {
      await db2.collection('products').updateOne({ _id: p._id }, { $set: updateDoc });
      fixedCount++;
    }
  }
  
  console.log(`Done! Updated prices for ${fixedCount} products in DB.`);
  
  await mongoose2.disconnect();
  await mongoose.disconnect();
}

run().catch(console.error);

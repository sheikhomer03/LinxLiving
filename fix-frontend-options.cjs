require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');

async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  const brand = await db.collection('brands').findOne({ name: 'Aica Bathrooms' });
  const products = await db2.collection('products').find({ brand: brand._id, $expr: { $gt: [{ $size: "$variants" }, 1] } }).toArray();
  
  console.log(`Fixing options for ${products.length} products...`);
  let fixedCount = 0;

  for (const p of products) {
    // 1. Gather all unique option axes from all variants
    const optionAxes = new Set();
    for (const v of p.variants) {
      if (v.options) {
        for (const key of Object.keys(v.options)) {
          optionAxes.add(key);
        }
      }
    }
    
    const axesArray = Array.from(optionAxes); // e.g. ["Size(mm)", "Color"]
    
    // 2. Build shopifyOptions
    const shopifyOptions = axesArray.map((name, i) => {
      const valuesSet = new Set();
      for (const v of p.variants) {
        if (v.options && v.options[name]) {
          valuesSet.add(v.options[name]);
        }
      }
      return {
        name: name,
        position: i + 1,
        values: Array.from(valuesSet)
      };
    });
    
    // 3. Mutate variants to include option1, option2, option3
    const newVariants = p.variants.map(v => {
      const newV = { ...v };
      if (v.options) {
        if (axesArray.length > 0) newV.option1 = String(v.options[axesArray[0]] || "");
        if (axesArray.length > 1) newV.option2 = String(v.options[axesArray[1]] || "");
        if (axesArray.length > 2) newV.option3 = String(v.options[axesArray[2]] || "");
      }
      return newV;
    });
    
    // 4. Update MongoDB
    await db2.collection('products').updateOne(
      { _id: p._id },
      { $set: { shopifyOptions: shopifyOptions, variants: newVariants } }
    );
    fixedCount++;
  }
  
  console.log(`Done! Fixed ${fixedCount} products.`);
  
  await mongoose2.disconnect();
  await mongoose.disconnect();
}

run().catch(console.error);

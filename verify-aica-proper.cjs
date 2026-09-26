require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');

async function run() {
  const { db, mongoose } = await connectMongo(); 
  const brand = await db.collection('brands').findOne({ name: "Aica Bathrooms" });

  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  // Find a product with multiple variants
  const multiVariantProduct = await db2.collection('products').findOne({ 
    brand: brand._id,
    $expr: { $gt: [{ $size: "$variants" }, 1] } 
  });
  
  console.log("--- MULTI-VARIANT PRODUCT EXAMPLE ---");
  if (multiVariantProduct) {
    console.log("Name:", multiVariantProduct.name);
    console.log("Category:", multiVariantProduct.department, ">", multiVariantProduct.category);
    console.log("Total Variants:", multiVariantProduct.variants.length);
    
    multiVariantProduct.variants.slice(0, 3).forEach((v, i) => {
      console.log(`\nVariant ${i + 1}:`);
      console.log(`  Name: ${v.name}`);
      console.log(`  Price: ${v.price}`);
      console.log(`  Options: ${JSON.stringify(v.options)}`);
      console.log(`  Image: ${v.imageUrl ? 'Yes' : 'No'}`);
    });
    
    if (multiVariantProduct.variants.length > 3) {
      console.log(`  ... and ${multiVariantProduct.variants.length - 3} more variants`);
    }
  } else {
    console.log("None found");
  }

  // Find a single variant product
  const singleVariantProduct = await db2.collection('products').findOne({ 
    brand: brand._id,
    $expr: { $eq: [{ $size: "$variants" }, 1] } 
  });
  
  console.log("\n--- SINGLE VARIANT PRODUCT EXAMPLE ---");
  if (singleVariantProduct) {
    console.log("Name:", singleVariantProduct.name);
    console.log("Price:", singleVariantProduct.price);
  } else {
    console.log("None found");
  }

  await mongoose2.disconnect();
  await mongoose.disconnect();
}
run().catch(console.error);

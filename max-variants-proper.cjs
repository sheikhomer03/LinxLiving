require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');

async function run() {
  const { db, mongoose } = await connectMongo();
  const brand = await db.collection('brands').findOne({ name: "Aica Bathrooms" });

  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);

  const products = await db2.collection('products').find({ brand: brand._id }).toArray();
  let max = 0;
  let maxName = "";
  for (const p of products) {
    if (p.variants && p.variants.length > max) {
      max = p.variants.length;
      maxName = p.name;
    }
  }
  console.log("Max variants:", max, "for product:", maxName);
  await mongoose2.disconnect();
  await mongoose.disconnect();
}
run().catch(console.error);

require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');

async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);
  
  const brand = await db.collection('brands').findOne({ name: 'Aica Bathrooms' });
  const result = await db2.collection('products').updateMany(
    { brand: brand._id },
    { $unset: { 'specs.size': "", 'specs.Size': "" } }
  );
  
  console.log(`Unset specs.size and specs.Size from ${result.modifiedCount} Aica products.`);
  
  await mongoose2.disconnect();
  await mongoose.disconnect();
}

run().catch(console.error);

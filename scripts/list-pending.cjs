const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
const mongoose = require('mongoose');

async function main() {
  const conn1 = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
  const conn2 = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 15000 }).asPromise();
  
  const brand = await conn1.db.collection('brands').findOne({ slug: 'total-tiles' });
  
  const pending = await conn2.db.collection('products')
    .find({ brand: brand._id, 'shopifyImages.0': { $exists: false } })
    .project({ name: 1, sourceUrl: 1, images: 1 })
    .toArray();
    
  console.log('=== The 32 Pending Products ===');
  pending.forEach((p, i) => {
    console.log(`${i+1}. ${p.name} (${(p.images || []).length} images)`);
  });
  
  await conn1.close();
  await conn2.close();
  process.exit(0);
}
main().catch(console.error);

const path = require('path');
const fs = require('fs');
require('dotenv').config({path: path.join(__dirname, '..', '.env.local')});
const mongoose = require('mongoose');
const { connectMongo } = require('./mongo-connect.cjs');

(async () => {
  const { db: primary } = await connectMongo();
  const brand = await primary.collection('brands').findOne({ slug: 'tiles-porcelain' });
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  const d = await conn.db.collection('products').findOne({ _id: new mongoose.Types.ObjectId('6ab4da50e5975c1dc71a8073') });
  
  if (!d) {
    console.log("Product not found");
    process.exit(0);
  }
  
  console.log('ID:', d._id);
  console.log('Name:', d.name);
  console.log('URL:', d.sourceUrl);
  console.log('Price:', d.price);
  console.log('Images:', d.images?.length);
  console.log('Specs:', d.specs);
  
  // Find other products with similar names to check for sizes
  const siblings = await conn.db.collection('products').find({ 
    brand: brand._id, 
    name: { $regex: /Diamond White Sparkly Quartz/, $options: 'i' }
  }).toArray();
  
  console.log('\nFound siblings:', siblings.length);
  siblings.forEach(s => {
    console.log('-', s.name, '| Price:', s.price, '| URL:', s.sourceUrl, '| variantSiblings:', s.specs?.variantSiblings?.length);
  });
  
  await conn.close();
  process.exit(0);
})();

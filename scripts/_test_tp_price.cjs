const mongoose = require('mongoose');
require('dotenv').config({path: '.env.local'});
(async () => {
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  const product = await conn.db.collection('products').findOne({ _id: new mongoose.Types.ObjectId('6ab4da52e5975c1dc71a8295') });
  console.log(product.price);
  console.log(product.specs['Box Quantity']);
  process.exit(0);
})();

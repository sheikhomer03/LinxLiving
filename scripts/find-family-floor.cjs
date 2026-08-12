const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");
  const rows = await Products.find({ name: { $regex: "Family Floor", $options: "i" } })
    .project({ name: 1, price: 1, specs: 1, category: 1, subCategory: 1 })
    .toArray();
  console.log(JSON.stringify(rows, null, 2));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

import connectDB from "./src/lib/mongodb";
import { Product } from "./src/models/Product";

async function checkCategories() {
  await connectDB();
  const categories = await Product.distinct("category");
  process.exit(0);
}

checkCategories();

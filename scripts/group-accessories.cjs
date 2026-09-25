require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({ "specs.Brand": "Tilesporcelain", category: "Accessories" }).toArray();
  
  const groups = {};
  
  for (const p of products) {
    // If name contains a hyphen, the part before it might be the base name
    const match = p.name.match(/^(.*?)-(.*)$/);
    if (match) {
      let baseName = match[1].trim();
      let colorOrSize = match[2].trim();
      
      // Special case: "Epoxy Grout and Glitter-Black-Gold Glitter 150g"
      // Wait, there are multiple hyphens!
      // Let's just group by the part before the FIRST hyphen!
      baseName = p.name.split('-')[0].trim();
      let variantName = p.name.substring(baseName.length + 1).trim();
      
      if (!groups[baseName]) groups[baseName] = [];
      groups[baseName].push({ name: variantName, product: p });
    } else {
      if (!groups[p.name]) groups[p.name] = [];
      groups[p.name].push({ name: "Base", product: p });
    }
  }
  
  for (const [base, items] of Object.entries(groups)) {
    if (items.length > 1) {
      console.log(`\nGroup: ${base} (${items.length} variants)`);
      items.forEach(i => console.log(`  - ${i.name} (Price: ${i.product.price})`));
    }
  }
  process.exit(0);
}
main().catch(console.error);

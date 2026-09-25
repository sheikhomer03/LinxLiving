require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({ "specs.Brand": "Tilesporcelain" }).toArray();
  
  const groups = {};
  
  for (const p of products) {
    let baseName = p.name;
    let variantName = "Base";
    
    // Only group accessories/grout/sealants, not tiles (tiles often have size in the name but are distinct)
    if (p.department === "tiles" && !p.category.includes("grout") && !p.category.includes("sealant") && !p.category.includes("adhesive")) {
      // It's a tile, skip grouping by name unless requested, but let's check what it would look like
    }
    
    // Let's just blindly group by everything before the FIRST hyphen for ANY product that has a hyphen!
    const hyphenIdx = p.name.indexOf('-');
    if (hyphenIdx > 0 && hyphenIdx < p.name.length - 1) {
      baseName = p.name.substring(0, hyphenIdx).trim();
      variantName = p.name.substring(hyphenIdx + 1).trim();
    }
    
    if (!groups[baseName]) groups[baseName] = [];
    groups[baseName].push({ name: variantName, product: p });
  }
  
  for (const [base, items] of Object.entries(groups)) {
    if (items.length > 1) {
      console.log(`\nGroup: ${base} (${items.length} variants)`);
      items.slice(0, 5).forEach(i => console.log(`  - ${i.name} (Price: ${i.product.price})`));
      if (items.length > 5) console.log(`  ... and ${items.length - 5} more`);
    }
  }
  process.exit(0);
}
main().catch(console.error);

require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

function getBaseName(name) {
  let bn = name;
  // Remove common sizes
  bn = bn.replace(/\b(\d+(?:\.\d+)?(?:mm|cm|m|x\d+(?:\.\d+)?(?:mm|cm|m)?|\s*x\s*\d+(?:\.\d+)?(?:mm|cm|m)?))\b/gi, '');
  
  // Remove common colors
  const colors = ["White", "Black", "Grey", "Anthracite", "Silver", "Gold", "Bronze", "Copper", "Brass", "Chrome", "Beige", "Oak", "Walnut", "Teak", "Blue", "Green", "Red", "Yellow", "Pink", "Matt", "Gloss", "Polished", "Brushed"];
  for (const c of colors) {
    const regex = new RegExp(`\\b${c}\\b`, 'gi');
    bn = bn.replace(regex, '');
  }
  
  // Remove extra spaces and common separators
  bn = bn.replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Clean up trailing/leading junk if any
  return bn.toLowerCase();
}

async function findVariants() {
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const db = client.db();
  const col = db.collection("products");

  const brands = [
    "Bathroom 4 Less", "Bathroom4Less", 
    "AL Murad", "Al Murad", 
    "Wall Sandfloors", "Walls and Floors", "Walls & Floors",
    "Total Tiles", 
    "Tiles Porcelain", "Tilesporcelain",
    "Capietra", "Ca' Pietra", "Ca Pietra"
  ];

  console.log("Searching for products in these brands:", brands.join(", "));

  // Find all products matching these brands (checking specs.Brand or name/source)
  const products = await col.find({
    $or: [
      { "specs.Brand": { $in: brands.map(b => new RegExp(b, 'i')) } },
      { sourceUrl: { $regex: new RegExp(brands.join("|").replace(/ /g, ".*"), "i") } }
    ]
  }).toArray();

  console.log(`Found ${products.length} total products for these brands.`);

  // Group by brand + base name
  const groups = new Map();

  for (const p of products) {
    const brand = p.specs?.Brand || "Unknown";
    // Check if it already has variants (maybe we grouped it before)
    if (p.variants && p.variants.length > 0) {
      continue; // Skip already merged
    }

    const base = getBaseName(p.name);
    const key = `${brand}|${base}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(p);
  }

  // Filter for groups with > 1 product
  let multiGroupsCount = 0;
  let multiProductsCount = 0;
  
  for (const [key, items] of groups.entries()) {
    if (items.length > 1) {
      multiGroupsCount++;
      multiProductsCount += items.length;
    } else {
      groups.delete(key);
    }
  }

  console.log(`\nFound ${multiGroupsCount} groups of variants containing ${multiProductsCount} total products.`);
  
  console.log("\nSample Groups:");
  let count = 0;
  for (const [key, items] of groups.entries()) {
    if (count++ > 5) break;
    console.log(`\nGroup: ${key} (${items.length} variants)`);
    items.forEach(i => console.log(`  - ${i.name} (£${i.price})`));
  }
  
  // Write full summary to a file for review
  const fs = require('fs');
  const summary = Array.from(groups.entries()).map(([k, items]) => ({
    groupKey: k,
    items: items.map(i => ({ name: i.name, price: i.price, _id: i._id }))
  }));
  fs.writeFileSync("../.scratch/variant-groups-plan.json", JSON.stringify(summary, null, 2));
  console.log(`\nFull list of potential groups saved to .scratch/variant-groups-plan.json`);

  await client.close();
}

findVariants().catch(console.error);
